import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { WebContents } from 'electron';
import type { Message, Conversation, ConversationSummary } from '../ipc/types';
import type { ChatMessage, AIProvider } from '../ai/AIProvider';
import { conversationRepo } from '../db/repositories/ConversationRepo';
import { providerFactory } from '../ai/ProviderFactory';
import { configManager } from '../config/ConfigManager';
import { documentProcessor } from '../documents/DocumentProcessor';
import { ArtifactParser } from '../artifacts/ArtifactParser';
import { artifactRepo } from '../db/repositories/ArtifactRepo';
import { usageRepo } from '../db/repositories/UsageRepo';
import { embeddingStore } from '../memory/EmbeddingStore';
import { kuzuGraph } from '../memory/KuzuGraph';
import { extractEntities } from '../memory/EntityExtractor';
import { summarizeIfNeeded } from '../memory/SessionSummarizer';
import { contextAssembler } from '../memory/ContextAssembler';
import { memoryRepo } from '../db/repositories/MemoryRepo';
import { OpenAIProvider } from '../ai/providers/OpenAIProvider';
import { OllamaProvider } from '../ai/providers/OllamaProvider';
import { log } from '../logger';

const ARTIFACT_INSTRUCTION = `
When generating files (code, HTML, JSON, CSV, scripts, configs, etc.), always wrap them in a named fenced code block so Harness can surface a download button:

\`\`\`language filename.ext
...file content...
\`\`\`

Always include a descriptive filename with the correct extension (e.g. \`analysis.py\`, \`report.html\`, \`data.csv\`).`;

// ─── Artifact fence stripping ─────────────────────────────────────────────────

// Named fenced block (complete): ```lang filename.ext\n...content...\n```
const ARTIFACT_BLOCK_RE = /^```\w+\s+\S+\.\S+[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
// Named fenced block (partial — no closing fence yet, runs to end of string)
const ARTIFACT_PARTIAL_RE = /^```\w+\s+\S+\.\S+[^\n]*\n[\s\S]*$/m;

function stripArtifactFences(text: string): string {
  ARTIFACT_BLOCK_RE.lastIndex = 0;
  let result = text.replace(ARTIFACT_BLOCK_RE, '');
  result = result.replace(ARTIFACT_PARTIAL_RE, '');
  return result.replace(/\n{3,}/g, '\n\n');
}

// ─── System prompt loading ────────────────────────────────────────────────────

function loadSystemPrompt(): string {
  const candidates = [
    path.join(app.getAppPath(), 'resources', 'CLAUDE.md'),
    path.join(__dirname, '..', '..', '..', 'resources', 'CLAUDE.md'),
    path.join(process.cwd(), 'resources', 'CLAUDE.md'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8') + ARTIFACT_INSTRUCTION;
    }
  }
  return `You are Harness, a Mac desktop AI agent. You help users think, write, and build software.
Be concise, direct, and helpful. Today's date is ${new Date().toISOString().slice(0, 10)}.${ARTIFACT_INSTRUCTION}`;
}

// ─── Embedding provider helper ────────────────────────────────────────────────

export function getEmbeddingProvider(config: import('../ipc/types').HarnessConfig): AIProvider | null {
  const ciphertext = config.ai.embeddingApiKeyCiphertext;
  if (!ciphertext) return null;
  const key = configManager.decryptKey(ciphertext);
  if (!key) return null;
  if (config.ai.embeddingProvider === 'openai') return new OpenAIProvider(key);
  if (config.ai.embeddingProvider === 'ollama') return new OllamaProvider(config.ai.ollama.baseUrl);
  return null;
}

// ─── Snippet extraction ───────────────────────────────────────────────────────

const PREAMBLE_RE = /^(i['']ll |let me |i will |i'm |i am going to |sure[,!]|certainly[,!]|of course|happy to|based on my|here are|here is |i can |i have |i've |i'd )/i;
const BADGE_RE   = /\n\n<!-- (?:context-strategy|memory-saved):[^>]+ -->/g;
const SNIPPET_MAX = 2500;

function extractSnippet(content: string): string {
  // Strip badge comments appended by AgentRunner
  const clean = content.replace(BADGE_RE, '').trim();

  // Split into paragraphs, drop empties and short filler lines
  const paras = clean.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 30);

  // Find first paragraph that doesn't look like preamble
  const start = paras.findIndex(p => !PREAMBLE_RE.test(p));
  const meaningful = paras.slice(start >= 0 ? start : 0).join('\n\n');

  return meaningful.slice(0, SNIPPET_MAX) || clean.slice(0, SNIPPET_MAX);
}

// ─── Background indexing ──────────────────────────────────────────────────────

async function indexTurns(
  userMsg: Message,
  assistantMsg: Message,
  conversationId: string,
  conversationTitle: string,
  embeddingProvider: AIProvider,
  chatProvider: AIProvider,
  model: string
): Promise<void> {
  for (const msg of [userMsg, assistantMsg]) {
    if (!msg.content || msg.content.startsWith('<context>') || msg.content.startsWith('<memory>')) continue;
    try {
      const snippet = extractSnippet(msg.content);
      const result = await embeddingProvider.embed(snippet);
      const raw = Array.isArray(result) ? result[0].embedding : result.embedding;
      const embedding = new Float32Array(raw);
      const tokenEstimate = Math.ceil(msg.content.split(/\s+/).length * 1.3);

      const TTL_MS = 90 * 24 * 60 * 60 * 1000;
      embeddingStore.insertTurn(
        msg.id, conversationId, conversationTitle, msg.role,
        snippet, embedding, tokenEstimate, msg.created_at,
        msg.created_at + TTL_MS
      );
      await kuzuGraph.addTurn(msg.id, conversationId, msg.role, msg.created_at, tokenEstimate);

      const entities = await extractEntities(snippet, chatProvider, model);
      if (entities.length > 0) {
        await kuzuGraph.addTurnEntities(msg.id, entities);
      }
    } catch {
      // Non-critical — skip silently
    }
  }
}

// ─── AgentRunner ──────────────────────────────────────────────────────────────

class AgentRunner {
  private systemPrompt: string | null = null;

  private getSystemPrompt(): string {
    if (!this.systemPrompt) {
      this.systemPrompt = loadSystemPrompt();
    }
    return this.systemPrompt;
  }

  async createConversation(systemPrompt?: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const config = await configManager.load();
    const model = config?.ai.model ?? 'unknown';

    const conv: Conversation = {
      id,
      title: 'New Conversation',
      model,
      created_at: now,
      updated_at: now,
      system_prompt_hash: systemPrompt
        ? crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)
        : '',
      messages: [],
      sub_agent_ids: [],
      skill_ids_used: [],
    };

    conversationRepo.insert(conv);
    log.agent.info({ conversationId: id }, 'Conversation created');
    return id;
  }

  async sendMessage(
    conversationId: string,
    userMessage: string,
    webContents: WebContents,
    attachmentPaths?: string[]
  ): Promise<void> {
    const config = await configManager.load();
    if (!config) throw new Error('No config loaded — complete onboarding first');

    const provider = providerFactory.getProvider(config);

    // Build user message content — plain string or ContentBlock[] with attachments
    let userContent: ChatMessage['content'] = userMessage;

    if (attachmentPaths && attachmentPaths.length > 0) {
      const attachmentBlocks = attachmentPaths.flatMap((fp) => {
        try {
          const { getMimeType } = require('../documents/DocumentProcessor') as typeof import('../documents/DocumentProcessor');
          const mimeType = getMimeType(fp);
          return documentProcessor.processFile(fp, mimeType, provider.id);
        } catch (err) {
          log.agent.warn({ fp, err }, 'Failed to process attachment — skipping');
          return [];
        }
      });

      if (attachmentBlocks.length > 0) {
        userContent = [
          { type: 'text', text: userMessage },
          ...attachmentBlocks,
        ];
      }
    }

    // Persist user message (always as string for DB storage)
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      created_at: Date.now(),
    };
    conversationRepo.appendMessage(conversationId, userMsg);

    // Handle /add-to-memory inline — stream the generated content, skip AI
    const memCmd = this.parseAddToMemory(userMessage);
    if (memCmd) {
      await this.handleAddToMemory(conversationId, memCmd.theme, memCmd.instruction, webContents);
      return;
    }

    const conv = conversationRepo.findById(conversationId);
    if (!conv) throw new Error(`Conversation ${conversationId} not found`);

    // Build provider messages array (typed as ChatMessage[])
    const baseSystemPrompt = this.getSystemPrompt();
    const personalityPrompt = config.personality?.prompt?.trim();
    const systemPrompt = personalityPrompt
      ? `${baseSystemPrompt}\n\n---\n${personalityPrompt}`
      : baseSystemPrompt;

    // Send only the last 4 turns verbatim — older context comes from ContextAssembler
    const HISTORY_WINDOW = 4;
    const recentMessages = conv.messages.slice(-HISTORY_WINDOW);
    const providerMessages: ChatMessage[] = recentMessages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
    }));

    // Replace the last user message with the content-block version if attachments present
    if (userContent !== userMessage && providerMessages.length > 0) {
      providerMessages[providerMessages.length - 1] = {
        role: 'user',
        content: userContent,
      };
    }

    // Assemble context (GraphRAG or FTS5 fallback)
    let contextResult: import('../memory/ContextAssembler').AssembledContext | null = null;
    try {
      const embeddingProvider = getEmbeddingProvider(config);
      contextResult = await contextAssembler.assemble(userMessage, conv, embeddingProvider);
      if (contextResult.contextBlock) {
        providerMessages.unshift({ role: 'user', content: contextResult.contextBlock });
      }
      const hasContext = contextResult.memItemCount > 0 || contextResult.relatedTurnCount > 0 || contextResult.hasSummary;
      if (hasContext) {
        log.memory.info(
          {
            conversationId,
            strategy: contextResult.strategy,
            memItems: contextResult.memItemCount,
            turns: contextResult.relatedTurnCount,
            summary: contextResult.hasSummary,
            tokens: contextResult.tokenEstimate,
          },
          'Context injected'
        );
      } else {
        log.memory.debug({ conversationId, strategy: contextResult.strategy }, 'No context — no matching memory or summary');
      }
    } catch (err) {
      log.memory.warn({ conversationId, err }, 'Context assembly failed — sending without context');
    }

    // Artifact parser — resets for each new message turn
    const parser = new ArtifactParser();
    let accumulated = '';
    let visibleAccumulated = '';
    const start = Date.now();
    const finalizedArtifacts: Array<{ id: string; name: string; language: string; content: string }> = [];

    try {
      for await (const chunk of provider.stream(providerMessages, {
        model: config.ai.model,
        systemPrompt,
      })) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          accumulated += chunk.delta;

          // Strip artifact fences so they never appear in the chat window
          const newVisible = stripArtifactFences(accumulated);
          const visibleDelta = newVisible.slice(visibleAccumulated.length);
          visibleAccumulated = newVisible;

          if (visibleDelta && !webContents.isDestroyed()) {
            webContents.send('stream:delta', { conversationId, delta: visibleDelta });
          }

          // Detect artifacts in accumulated text (full, unstripped)
          const artifactEvents = parser.feed(accumulated);
          for (const event of artifactEvents) {
            if (event.type === 'finalized') {
              finalizedArtifacts.push({ id: event.id, name: event.name, language: event.language, content: event.content });
            }
            if (!webContents.isDestroyed()) {
              webContents.send(`artifact:${event.type}`, {
                id: event.id,
                name: event.name,
                language: event.language,
                ...(event.type !== 'created' ? { content: event.content } : {}),
              });
            }
          }
        } else if (chunk.type === 'done') {
          // Flush any artifact that never got a closing fence (truncated by max_tokens)
          const flushedEvents = parser.flush(accumulated);
          for (const event of flushedEvents) {
            finalizedArtifacts.push({ id: event.id, name: event.name, language: event.language, content: event.content });
            if (!webContents.isDestroyed()) {
              webContents.send('artifact:finalized', {
                id: event.id, name: event.name, language: event.language, content: event.content,
              });
            }
          }

          // Compute turn index and full-history estimate for usage tracking
          const turnIndex = Math.floor(conv.messages.length / 2);
          const fullHistoryTokens = conv.messages.reduce(
            (s, m) => s + Math.ceil(m.content.length / 4), 0
          ) + 1000;

          // Append context strategy badge if any context was injected
          let contentWithBadge = visibleAccumulated;
          if (contextResult && (contextResult.memItemCount > 0 || contextResult.relatedTurnCount > 0 || contextResult.hasSummary)) {
            const savedTokens = Math.max(0, fullHistoryTokens - (chunk.inputTokens ?? 0));
            const badgeData = {
              strategy: contextResult.strategy,
              memItems: contextResult.memItemCount,
              turns: contextResult.relatedTurnCount,
              summary: contextResult.hasSummary,
              savedTokens,
            };
            contentWithBadge += `\n\n<!-- context-strategy:${JSON.stringify(badgeData)} -->`;
          }

          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: contentWithBadge,
            created_at: Date.now(),
          };

          conversationRepo.appendMessage(conversationId, assistantMsg);

          // Persist finalized artifacts now that we have the message ID
          const now = Date.now();
          for (const art of finalizedArtifacts) {
            try {
              artifactRepo.insert({
                id: art.id,
                conversationId,
                messageId: assistantMsg.id,
                name: art.name,
                language: art.language,
                content: art.content,
                createdAt: now,
              });
            } catch (err) {
              log.db.warn({ err, id: art.id }, 'Failed to persist artifact');
            }
          }

          // Record usage if token counts available
          if (chunk.inputTokens !== undefined) {
            try {
              usageRepo.insert({
                conversationId,
                model: config.ai.model,
                timestamp: now,
                inputTokens: chunk.inputTokens,
                outputTokens: chunk.outputTokens ?? 0,
                costUsd: chunk.costUsd ?? 0,
                source: 'chat',
                turnIndex,
                fullHistoryTokens,
              });
            } catch (err) {
              log.db.warn({ err }, 'Failed to persist usage event');
            }
          }

          if (!webContents.isDestroyed()) {
            webContents.send('stream:done', { conversationId, message: assistantMsg });
          }

          log.agent.info(
            { conversationId, latencyMs: Date.now() - start, chars: accumulated.length },
            'Stream complete'
          );

          if (conv.messages.length === 1) {
            // Fire-and-forget: generate AI title after first exchange
            this.generateAndSetTitle(conversationId, userMessage, visibleAccumulated, webContents).catch(
              (err) => log.agent.warn({ err }, 'Title generation failed')
            );
          }

          // Background: index turns, extract entities, update session summary, promote to memory
          const convTitle = conv.title;
          void (async () => {
            try {
              const embeddingProvider = getEmbeddingProvider(config);
              if (embeddingProvider) {
                await indexTurns(userMsg, assistantMsg, conversationId, convTitle, embeddingProvider, provider, config.ai.model);
              }
              const freshConv = conversationRepo.findById(conversationId);
              if (freshConv) {
                await summarizeIfNeeded(freshConv, provider, config.ai.model);

                // Promote to memory once conversation reaches CONV_TURN_MIN turns
                const CONV_TURN_MIN = 6;
                if (embeddingProvider && freshConv.messages.length >= CONV_TURN_MIN * 2) {
                  const { promotionService } = await import('../memory/PromotionService');
                  const promotionResult = await promotionService.run(embeddingProvider, provider);
                  // Broadcast newly promoted items so the Memory pane updates live
                  if (promotionResult.promotedItems.length > 0 && !webContents.isDestroyed()) {
                    for (const item of promotionResult.promotedItems) {
                      webContents.send('memory:itemAdded', item);
                    }
                    log.memory.info({ count: promotionResult.promotedItems.length }, 'Live memory update sent to renderer');
                  }
                }
              }
            } catch (err) {
              log.memory.debug({ err }, 'Background indexing error');
            }
          })();
        } else if (chunk.type === 'error') {
          log.agent.error({ conversationId, error: chunk.error }, 'Stream error');
          if (!webContents.isDestroyed()) {
            webContents.send('stream:error', { conversationId, error: chunk.error });
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.agent.error({ conversationId, err }, 'sendMessage error');
      if (!webContents.isDestroyed()) {
        webContents.send('stream:error', { conversationId, error });
      }
    }
  }

  private parseAddToMemory(message: string): { theme: string; instruction: string } | null {
    const idx = message.lastIndexOf('/add-to-memory');
    if (idx === -1) return null;
    if (idx > 0 && !/\s/.test(message[idx - 1])) return null;

    const prefixContext = message.slice(0, idx).trim();
    const slashArgs = message.slice(idx + '/add-to-memory'.length).trim();
    const parts = slashArgs.split(/\s+/);
    const theme = parts[0];
    if (!theme) return null;

    const instructionFromArgs = parts.slice(1).join(' ');
    const instruction = [instructionFromArgs, prefixContext].filter(Boolean).join(' ') || theme;
    return { theme, instruction };
  }

  private async handleAddToMemory(
    conversationId: string,
    theme: string,
    instruction: string,
    webContents: WebContents
  ): Promise<void> {
    try {
      const config = await configManager.load();
      if (!config) throw new Error('No config loaded');
      const provider = providerFactory.getProvider(config);

      let historyBlock = '';
      const conv = conversationRepo.findById(conversationId);
      if (conv?.messages.length) {
        const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const recent = conv.messages
          .filter((m) => !m.content.startsWith('<memory>') && m.created_at >= threeMonthsAgo)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');
        historyBlock = `\n\nRecent conversation:\n${recent}`;
      }

      const prompt = `You are a memory extraction assistant. Create a rich, retrievable memory note.

Theme: "${theme}"
User's instruction: "${instruction}"${historyBlock}

Rules:
- If the instruction references the conversation, extract all key insights, decisions, action items, and relevant details for the theme. Preserve structure — use bullet points, numbered lists, or paragraphs as appropriate.
- If the instruction is already a note or list, preserve it fully. Expand with context (who, what, why, numbers, names, dates, outcomes) only where it adds retrieval value.
- No length restriction. Write as much as needed — up to a full page. Prioritize completeness and specificity over brevity.
- Output ONLY the memory content. No preamble, no quotes, no explanation.`;

      let content = '';
      let memInputTokens = 0, memOutputTokens = 0, memCostUsd = 0;
      for await (const chunk of provider.stream([{ role: 'user', content: prompt }], {
        model: config.ai.model,
        maxTokens: 4096,
        temperature: 0.2,
      })) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          content += chunk.delta;
          if (!webContents.isDestroyed()) {
            webContents.send('stream:delta', { conversationId, delta: chunk.delta });
          }
        } else if (chunk.type === 'done' && chunk.inputTokens !== undefined) {
          memInputTokens = chunk.inputTokens;
          memOutputTokens = chunk.outputTokens ?? 0;
          memCostUsd = chunk.costUsd ?? 0;
        }
      }

      content = content.trim();
      if (memInputTokens > 0) {
        try {
          usageRepo.insert({
            conversationId,
            model: config.ai.model,
            timestamp: Date.now(),
            inputTokens: memInputTokens,
            outputTokens: memOutputTokens,
            costUsd: memCostUsd,
            source: 'memory_gen',
          });
        } catch (err) {
          log.db.warn({ err }, 'Failed to persist memory usage event');
        }
      }

      const item = memoryRepo.insert(theme, content, 'command');

      // Background: embed and graph-index the new memory item
      void (async () => {
        try {
          const embeddingProvider = getEmbeddingProvider(config);
          if (embeddingProvider) {
            const result = await embeddingProvider.embed(content.slice(0, 500));
            const raw = Array.isArray(result) ? result[0].embedding : result.embedding;
            embeddingStore.insertMemory(item.id, new Float32Array(raw), item.created_at);
            await kuzuGraph.addMemoryItem(item.id, item.theme, item.created_at);
            const entities = await extractEntities(content.slice(0, 500), provider, config.ai.model);
            if (entities.length > 0) await kuzuGraph.addMemoryEntities(item.id, entities);
          }
        } catch {
          // Non-critical
        }
      })();

      const badge = `\n\n<!-- memory-saved:${JSON.stringify({ theme: item.theme, id: item.id })} -->`;
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: content + badge,
        created_at: Date.now(),
      };
      conversationRepo.appendMessage(conversationId, assistantMsg);

      if (!webContents.isDestroyed()) {
        webContents.send('stream:done', { conversationId, message: assistantMsg });
        webContents.send('memory:itemAdded', item);
      }

      log.memory.info({ theme: item.theme, id: item.id }, 'Memory item saved via command');
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.memory.error({ err }, 'Failed to save memory item');
      if (!webContents.isDestroyed()) {
        webContents.send('stream:error', { conversationId, error });
      }
    }
  }

  async generateMemoryItem(
    conversationId: string | undefined,
    theme: string,
    instruction: string
  ): Promise<string> {
    const config = await configManager.load();
    if (!config) throw new Error('No config loaded');

    const provider = providerFactory.getProvider(config);

    let historyBlock = '';
    if (conversationId) {
      const conv = conversationRepo.findById(conversationId);
      if (conv?.messages.length) {
        const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const recent = conv.messages
          .filter((m) => !m.content.startsWith('<memory>') && m.created_at >= threeMonthsAgo)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');
        historyBlock = `\n\nRecent conversation:\n${recent}`;
      }
    }

    const prompt = `You are a memory extraction assistant. Create a rich, retrievable memory note.

Theme: "${theme}"
User's instruction: "${instruction}"${historyBlock}

Rules:
- If the instruction references the conversation, extract all key insights, decisions, action items, and relevant details for the theme. Preserve structure — use bullet points, numbered lists, or paragraphs as appropriate.
- If the instruction is already a note or list, preserve it fully. Expand with context (who, what, why, numbers, names, dates, outcomes) only where it adds retrieval value.
- No length restriction. Write as much as needed — up to a full page. Prioritize completeness and specificity over brevity.
- Output ONLY the memory content. No preamble, no quotes, no explanation.`;

    const response = await provider.chat([{ role: 'user', content: prompt }], {
      model: config.ai.model,
      maxTokens: 4096,
      temperature: 0.2,
    });

    return response.content.trim();
  }

  private async generateAndSetTitle(
    conversationId: string,
    userMessage: string,
    assistantReply: string,
    webContents: WebContents
  ): Promise<void> {
    const config = await configManager.load();
    if (!config) return;
    const provider = providerFactory.getProvider(config);

    const snippet = assistantReply.slice(0, 300);
    const prompt = `Generate a short conversation title (5–8 words, no quotes, no punctuation at end) that captures the topic of this exchange:

User: ${userMessage.slice(0, 200)}
Assistant: ${snippet}

Reply with only the title.`;

    const response = await provider.chat([{ role: 'user', content: prompt }], {
      model: config.ai.model,
      maxTokens: 24,
      temperature: 0.3,
    });

    const title = response.content.trim().replace(/^["']|["']$/g, '').slice(0, 80);
    if (!title) return;

    conversationRepo.updateTitle(conversationId, title);
    if (!webContents.isDestroyed()) {
      webContents.send('conversation:titleUpdated', { conversationId, title });
    }
    log.agent.debug({ conversationId, title }, 'Conversation title generated');
  }

  getHistory(conversationId: string): Message[] {
    const conv = conversationRepo.findById(conversationId);
    return conv?.messages ?? [];
  }

  listConversations(): ConversationSummary[] {
    return conversationRepo.list();
  }

  deleteConversation(conversationId: string): void {
    conversationRepo.archive(conversationId);
    log.agent.info({ conversationId }, 'Conversation archived');
  }
}

export const agentRunner = new AgentRunner();
