import { embeddingStore } from './EmbeddingStore';
import { memoryRepo } from '../db/repositories/MemoryRepo';
import { kuzuGraph } from './KuzuGraph';
import { log } from '../logger';
import type { AIProvider } from '../ai/AIProvider';
import type { MemoryItem } from '../../shared/types';

const PROMOTION_THRESHOLD = 5;    // cross-conversation: access_count >= 5
const CONV_TURN_MIN       = 6;    // single-conversation: promote if conv has >= 6 turns
const DEDUP_SIM_THRESHOLD = 0.85; // cosine > 0.85 with existing memory → skip
const EMBED_LIMIT         = 500;  // chars passed to embed()
const EXTRACT_INPUT_MAX   = 2500; // max chars fed into the extraction prompt
const EXTRACT_OUTPUT_MAX  = 600;  // max tokens in extracted output (~2500 chars)

export interface PromotionResult {
  checked: number;
  promoted: number;
  skippedDuplicate: number;
  skippedNoEmbedding: number;
  promotedItems: MemoryItem[];
}

// ─── LLM key-fact extraction ──────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Extract only the key facts and important information from the AI response below for persistent memory storage.

Rules:
- KEEP: specific numbers, names, dates, requirements, lists, decisions, conclusions, structured data, comparisons
- REMOVE: conversational preamble ("I'll search...", "Let me...", "Based on my..."), verbose explanations, filler phrases, repeated content
- FORMAT: bullet points for lists and structured data; short dense sentences for factual summaries
- MAX 350 words — be ruthlessly concise
- If the response contains a table or numbered list, preserve that structure exactly

AI response:
{content}

Key facts (memory only):`;

async function extractKeyFacts(content: string, chatProvider: AIProvider): Promise<string> {
  const input = content.slice(0, EXTRACT_INPUT_MAX);
  const prompt = EXTRACTION_PROMPT.replace('{content}', input);
  try {
    const result = await chatProvider.chat(
      [{ role: 'user', content: prompt }],
      { maxTokens: EXTRACT_OUTPUT_MAX }
    );
    const extracted = result.content.trim();
    return extracted.length > 50 ? extracted : content.slice(0, EXTRACT_INPUT_MAX);
  } catch (err) {
    log.memory.warn({ err }, 'PromotionService: extraction failed — using raw snippet');
    return content.slice(0, EXTRACT_INPUT_MAX);
  }
}

// ─── PromotionService ─────────────────────────────────────────────────────────

class PromotionService {
  /**
   * Two promotion paths:
   * 1. Cross-conversation: turns with access_count >= PROMOTION_THRESHOLD
   * 2. Single-conversation: assistant turns from conversations with >= CONV_TURN_MIN turns
   *
   * chatProvider is optional — if omitted, raw snippet is stored without extraction.
   */
  async run(embeddingProvider: AIProvider, chatProvider?: AIProvider): Promise<PromotionResult> {
    const result: PromotionResult = {
      checked: 0,
      promoted: 0,
      skippedDuplicate: 0,
      skippedNoEmbedding: 0,
      promotedItems: [],
    };

    const freqCandidates = embeddingStore.getTurnsByAccessCount(PROMOTION_THRESHOLD, 200);
    const convCandidates = embeddingStore.getAssistantTurnsFromSubstantialConversations(CONV_TURN_MIN, 200);

    // Merge, deduplicate by messageId
    const seen = new Set<string>();
    const candidates = [...freqCandidates, ...convCandidates].filter((t) => {
      if (seen.has(t.messageId)) return false;
      seen.add(t.messageId);
      return true;
    });

    result.checked = candidates.length;

    if (candidates.length === 0) {
      log.memory.info('PromotionService: no candidates');
      return result;
    }

    log.memory.info(
      { freqCandidates: freqCandidates.length, convCandidates: convCandidates.length, total: candidates.length },
      'PromotionService: checking candidates'
    );

    for (const turn of candidates) {
      try {
        // Embed focused window for dedup + vector search
        const embedText = turn.contentSnippet.slice(0, EMBED_LIMIT);
        const raw = await embeddingProvider.embed(embedText);
        const embedding = new Float32Array(
          Array.isArray(raw) ? raw[0].embedding : raw.embedding
        );

        // Secondary dedup: skip if a very similar memory item already exists
        // (primary dedup is promoted_at=0 filter — this catches edge cases)
        const similar = embeddingStore.searchMemory(embedding, 1);
        if (similar.length > 0 && similar[0].similarity > DEDUP_SIM_THRESHOLD) {
          result.skippedDuplicate++;
          // Still mark promoted so we don't re-check this turn on every run
          embeddingStore.markPromoted(turn.messageId);
          log.memory.debug(
            { messageId: turn.messageId, sim: similar[0].similarity },
            'PromotionService: skipped — near-duplicate'
          );
          continue;
        }

        // Extract key facts if chat provider available, otherwise fall back to raw
        const memoryContent = chatProvider
          ? await extractKeyFacts(turn.contentSnippet, chatProvider)
          : turn.contentSnippet.slice(0, EXTRACT_INPUT_MAX);

        const theme = (turn.conversationTitle || 'general').toLowerCase().trim();
        const item = memoryRepo.insert(theme, memoryContent, 'auto');

        embeddingStore.insertMemory(item.id, embedding, item.created_at);
        await kuzuGraph.addMemoryItem(item.id, item.theme, item.created_at);
        embeddingStore.markPromoted(turn.messageId);

        result.promoted++;
        result.promotedItems.push(item);
        log.memory.info(
          { messageId: turn.messageId, memoryId: item.id, theme: item.theme, chars: memoryContent.length },
          'PromotionService: turn promoted to memory'
        );
      } catch (err) {
        result.skippedNoEmbedding++;
        log.memory.warn({ err, messageId: turn.messageId }, 'PromotionService: failed — skipping');
      }
    }

    log.memory.info(result, 'PromotionService: run complete');
    return result;
  }
}

export const promotionService = new PromotionService();
