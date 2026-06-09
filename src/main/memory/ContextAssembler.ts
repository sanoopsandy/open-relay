import type { AIProvider, EmbeddingResponse } from '../ai/AIProvider';
import type { Conversation } from '../ipc/types';
import type { MemoryItem } from '../../shared/types';
import { memoryRepo } from '../db/repositories/MemoryRepo';
import { embeddingStore } from './EmbeddingStore';
import { kuzuGraph } from './KuzuGraph';
import { getSessionSummary } from './SessionSummarizer';
import { log } from '../logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENCY_LAMBDA = 0.05;  // 14-day half-life
const FREQ_DECAY_K   = 5;     // freqBoost saturates ~1.0 at access_count ≈ 15
const TOKEN_CAP = 3000;
const SIM_THRESHOLD = 0.25;   // Minimum cosine similarity to include a result

// ─── Helpers ─────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3) + 10;
}

function recencyScore(createdAt: number): number {
  const daysSince = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  return Math.exp(-RECENCY_LAMBDA * daysSince);
}

function freqBoost(accessCount: number): number {
  return 1 - Math.exp(-accessCount / FREQ_DECAY_K);
}

function formatAge(createdAt: number): string {
  const daysAgo = Math.round((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  return `${daysAgo}d ago`;
}

function toFloat32(embedding: number[]): Float32Array {
  return new Float32Array(embedding);
}

function getEmbedding(result: EmbeddingResponse | EmbeddingResponse[]): number[] {
  return Array.isArray(result) ? result[0].embedding : result.embedding;
}

// ─── Assembled context ────────────────────────────────────────────────────────

export interface AssembledContext {
  contextBlock: string;
  tokenEstimate: number;
  strategy: 'graphrag' | 'fts_fallback';
  memItemCount: number;
  relatedTurnCount: number;
  hasSummary: boolean;
}

// ─── ContextAssembler ─────────────────────────────────────────────────────────

class ContextAssembler {
  async assemble(
    query: string,
    conversation: Conversation,
    embeddingProvider: AIProvider | null
  ): Promise<AssembledContext> {

    const sessionSummary = getSessionSummary(conversation.id);

    if (embeddingProvider) {
      try {
        return await this.assembleGraphRAG(query, conversation, embeddingProvider, sessionSummary);
      } catch (err) {
        log.memory.warn({ err, conversationId: conversation.id }, 'GraphRAG assembly failed — falling back to FTS5');
      }
    }

    return this.assembleFTS(query, conversation, sessionSummary);
  }

  // ── GraphRAG path ─────────────────────────────────────────────────────────

  private async assembleGraphRAG(
    query: string,
    conversation: Conversation,
    provider: AIProvider,
    sessionSummary: string | null
  ): Promise<AssembledContext> {
    let tokenBudget = TOKEN_CAP;
    const parts: string[] = [];

    // Session summary (reserved budget)
    if (sessionSummary) {
      const summaryBlock = `Session so far:\n${sessionSummary}`;
      parts.push(summaryBlock);
      tokenBudget -= estimateTokens(summaryBlock);
    }

    // Embed the query
    const raw = getEmbedding(await provider.embed(query));
    const queryVec = toFloat32(raw);

    // Vector search: memory items
    const similarMemory = embeddingStore.searchMemory(queryVec, 10);
    const memorySimMap = new Map(similarMemory.map((m) => [m.memoryId, m]));

    // Vector search: turns from other conversations
    const similarTurns = embeddingStore.searchTurns(queryVec, 10, conversation.id);

    // Graph expansion (1-hop via Kuzu) — enriches candidate sets
    const turnIds = similarTurns.map((t) => t.messageId);
    const memoryIds = similarMemory.map((m) => m.memoryId);
    const expandedMemoryIds = await kuzuGraph.getRelatedMemoryIds(turnIds);
    const expandedTurnIds = await kuzuGraph.getRelatedTurnIds(memoryIds);

    // Merge candidate memory IDs (vector matches + graph expansion)
    const allMemoryIds = [...new Set([...memoryIds, ...expandedMemoryIds])];

    // Fetch full memory item content
    const memoryItems: MemoryItem[] = allMemoryIds
      .map((id) => memoryRepo.getById(id))
      .filter((item): item is MemoryItem => item !== null);

    // [TEMP] log raw vector search hits before scoring
    log.memory.info({
      conversationId: conversation.id,
      memoryHits: similarMemory.map((m) => ({ id: m.memoryId, sim: +m.similarity.toFixed(3), freq: m.accessCount })),
      turnHits: similarTurns.map((t) => ({ id: t.messageId, sim: +t.similarity.toFixed(3), freq: t.accessCount, snippet: t.contentSnippet.slice(0, 80) })),
      expandedMemoryIds,
      expandedTurnIds,
    }, '[TEMP] GraphRAG: raw retrieval hits');

    // Score memory items: sim × 0.35 + recency × 0.35 + freqBoost × 0.30
    const scoredMemory = memoryItems
      .map((item) => {
        const entry = memorySimMap.get(item.id);
        const sim   = entry?.similarity ?? 0.35;
        const freq  = entry?.accessCount ?? 0;
        const score = sim * 0.35 + recencyScore(item.created_at) * 0.35 + freqBoost(freq) * 0.30;
        return { item, score, sim };
      })
      .filter(({ sim }) => sim >= SIM_THRESHOLD || memorySimMap.has('') === false) // keep graph-expanded even if below threshold
      .sort((a, b) => b.score - a.score);

    // [TEMP] log scored memory items
    log.memory.info({
      conversationId: conversation.id,
      scoredMemory: scoredMemory.map(({ item, score, sim }) => ({
        theme: item.theme,
        score: +score.toFixed(3),
        sim: +sim.toFixed(3),
        content: item.content.slice(0, 100),
      })),
    }, '[TEMP] GraphRAG: scored memory items');

    // Merge candidate turn IDs (vector matches + graph expansion)
    const allTurnSimMap = new Map(similarTurns.map((t) => [t.messageId, t]));
    const expandedOnlyIds = expandedTurnIds.filter((id) => !allTurnSimMap.has(id));

    // For graph-expanded turns without similarity score, use a default
    const expandedTurnDetails = expandedOnlyIds
      .map((id) => {
        const rows = (() => {
          try {
            return embeddingStore.searchTurns(queryVec, 1);
          } catch {
            return [];
          }
        })();
        return rows.find((r) => r.messageId === id) ?? null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const allScoredTurns = [
      ...similarTurns.filter((t) => t.similarity >= SIM_THRESHOLD),
      ...expandedTurnDetails,
    ];

    // Score turns: sim × 0.35 + recency × 0.35 + freqBoost × 0.30
    const scoredTurns = allScoredTurns
      .map((t) => ({
        turn: t,
        score: t.similarity * 0.35 + recencyScore(t.createdAt) * 0.35 + freqBoost(t.accessCount) * 0.30,
      }))
      .sort((a, b) => b.score - a.score);

    // [TEMP] log scored turns
    log.memory.info({
      conversationId: conversation.id,
      scoredTurns: scoredTurns.map(({ turn, score }) => ({
        role: turn.role,
        convTitle: turn.conversationTitle,
        score: +score.toFixed(3),
        sim: +turn.similarity.toFixed(3),
        freq: turn.accessCount,
        snippet: turn.contentSnippet.slice(0, 100),
      })),
    }, '[TEMP] GraphRAG: scored turns');

    // Pack memory items greedily
    const memoryLines: string[] = [];
    for (const { item } of scoredMemory) {
      const line = `• [${item.theme} | ${formatAge(item.created_at)}] ${item.content}`;
      const t = estimateTokens(line);
      if (tokenBudget - t < 200) break; // leave headroom for turns
      memoryLines.push(line);
      tokenBudget -= t;
    }

    // Pack related turns greedily
    const turnLines: string[] = [];
    for (const { turn } of scoredTurns) {
      const label = `${turn.role} | ${turn.conversationTitle || 'Past session'} | ${formatAge(turn.createdAt)}`;
      const line = `• [${label}] ${turn.contentSnippet}`;
      const t = estimateTokens(line);
      if (tokenBudget - t < 0) break;
      turnLines.push(line);
      tokenBudget -= t;
    }

    if (memoryLines.length > 0) {
      parts.push(`Memory items:\n${memoryLines.join('\n')}`);
    }
    if (turnLines.length > 0) {
      parts.push(`Related from past sessions:\n${turnLines.join('\n')}`);
    }

    if (parts.length === 0) {
      return { contextBlock: '', tokenEstimate: 0, strategy: 'graphrag', memItemCount: 0, relatedTurnCount: 0, hasSummary: !!sessionSummary };
    }

    const contextBlock = `<context>\n${parts.join('\n\n')}\n</context>`;
    const tokenEstimate = TOKEN_CAP - tokenBudget;

    // [TEMP] log the full context block sent to the model
    log.memory.info({
      conversationId: conversation.id,
      tokenEstimate,
      memItemCount: memoryLines.length,
      relatedTurnCount: turnLines.length,
      contextBlock,
    }, '[TEMP] GraphRAG: full context block');

    return { contextBlock, tokenEstimate, strategy: 'graphrag', memItemCount: memoryLines.length, relatedTurnCount: turnLines.length, hasSummary: !!sessionSummary };
  }

  // ── FTS5 fallback path (preserves current behavior + adds session summary) ─

  private assembleFTS(
    query: string,
    conversation: Conversation,
    sessionSummary: string | null
  ): AssembledContext {
    const allThemes = memoryRepo.listThemes();
    const injectedIds = new Set<string>();
    const injectedItems: MemoryItem[] = [];

    if (allThemes.length > 0) {
      const msgLower = query.toLowerCase();
      for (const theme of allThemes) {
        if (msgLower.includes(theme.toLowerCase())) {
          for (const item of memoryRepo.getByTheme(theme)) {
            if (!injectedIds.has(item.id)) {
              injectedIds.add(item.id);
              injectedItems.push(item);
            }
          }
        }
      }
      for (const item of memoryRepo.search(query)) {
        if (!injectedIds.has(item.id)) {
          injectedIds.add(item.id);
          injectedItems.push(item);
        }
      }
    }

    // Build the memory block (matches current format exactly)
    let contextBlock = '';

    if (allThemes.length > 0) {
      const headerLine = `Available memory themes: ${allThemes.join(', ')}`;
      let block = `<memory>\n${headerLine}`;

      if (injectedItems.length > 0) {
        const lines = injectedItems.map(
          (item) => `• [${item.theme} | ${formatAge(item.created_at)}] ${item.content}`
        );
        block += `\n\nRelevant memory items:\n${lines.join('\n')}`;
      }

      if (sessionSummary) {
        block += `\n\nSession so far:\n${sessionSummary}`;
      }

      block += '\n</memory>';
      contextBlock = block;
    } else if (sessionSummary) {
      contextBlock = `<context>\nSession so far:\n${sessionSummary}\n</context>`;
    }

    const tokenEstimate = estimateTokens(contextBlock);

    // [TEMP] log FTS5 retrieval results and context block
    log.memory.info({
      conversationId: conversation.id,
      strategy: 'fts_fallback',
      injectedItems: injectedItems.map((i) => ({ theme: i.theme, content: i.content.slice(0, 100) })),
      contextBlock: contextBlock.slice(0, 600),
    }, '[TEMP] FTS5: context block');

    return { contextBlock, tokenEstimate, strategy: 'fts_fallback', memItemCount: injectedItems.length, relatedTurnCount: 0, hasSummary: !!sessionSummary };
  }
}

export const contextAssembler = new ContextAssembler();
