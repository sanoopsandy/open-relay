import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  EmbeddingResponse,
  ContentBlock,
} from '../AIProvider';
import { log } from '../../logger';

// ─── Cost table (USD per 1M tokens) ──────────────────────────────────────────

const COST_TABLE: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8':               { input: 15.0,  output: 75.0  },
  'claude-fable-5':                { input: 3.0,   output: 15.0  },
  'claude-opus-4-5':               { input: 5.0,   output: 25.0  },
  'claude-sonnet-4-6':             { input: 3.0,   output: 15.0  },
  'claude-sonnet-4-5':             { input: 3.0,   output: 15.0  },
  'claude-haiku-4-5-20251001':     { input: 0.25,  output: 1.25  },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_TABLE[model] ?? { input: 3.0, output: 15.0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// Newer Claude models (4.6+, 4.8, fable-5) deprecate the temperature parameter
const NO_TEMPERATURE_MODELS = new Set([
  'claude-opus-4-8',
  'claude-fable-5',
  'claude-sonnet-4-6',
]);

function allowsTemperature(model: string): boolean {
  return !NO_TEMPERATURE_MODELS.has(model);
}

// Max output tokens per model — Anthropic API requires max_tokens; use model's actual ceiling
const MAX_OUTPUT_TOKENS: Record<string, number> = {
  'claude-opus-4-8':           32768,
  'claude-fable-5':            64000,
  'claude-sonnet-4-6':         64000,
  'claude-opus-4-5':           32768,
  'claude-sonnet-4-5':         8192,
  'claude-haiku-4-5-20251001': 8192,
};

function modelMaxTokens(model: string): number {
  return MAX_OUTPUT_TOKENS[model] ?? 8192;
}

const ERROR_LABELS: Record<string, string> = {
  overloaded_error:     'Anthropic is overloaded — please try again in a moment.',
  rate_limit_error:     'Rate limit reached — wait a few seconds and retry.',
  authentication_error: 'Invalid API key — check your Claude key in Settings.',
};

function extractApiErrorType(raw: unknown): string | null {
  // raw may be an object like { error: { type: '...' } } or { type: 'error', error: { type: '...' } }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const inner = (r['error'] ?? r) as Record<string, unknown>;
    if (typeof inner['type'] === 'string') return inner['type'];
  }
  // raw may be a JSON string
  if (typeof raw === 'string') {
    try {
      return extractApiErrorType(JSON.parse(raw));
    } catch { /* not JSON */ }
  }
  return null;
}

function friendlyApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // Check .error body (Anthropic SDK APIError shape)
    const type = extractApiErrorType(e['error']) ?? extractApiErrorType(e['message']);
    if (type && ERROR_LABELS[type]) return ERROR_LABELS[type];
    // Fallback to .message if it's a plain string
    if (typeof e['message'] === 'string' && !e['message'].startsWith('{')) return e['message'];
  }
  return err instanceof Error ? err.message : String(err);
}

// ─── ClaudeProvider ───────────────────────────────────────────────────────────

export class ClaudeProvider implements AIProvider {
  readonly id = 'claude';
  readonly displayName = 'Anthropic Claude';
  readonly supportsEmbeddings = false;
  readonly defaultModel = 'claude-sonnet-4-6';
  readonly availableModels = [
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-opus-4-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5-20251001',
  ];

  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? this.defaultModel;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.model;

    // Separate system messages from conversation messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt =
      options.systemPrompt ??
      (systemMessages.length > 0
        ? systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
        : undefined);

    const anthropicMessages: Anthropic.MessageParam[] = conversationMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as ContentBlock[]).map(mapContentBlock) as Anthropic.MessageParam['content'],
    }));

    const response = await this.client.messages.create({
      model,
      max_tokens: options.maxTokens ?? modelMaxTokens(model),
      ...(allowsTemperature(model) && options.temperature !== undefined ? { temperature: options.temperature } : {}),
      system: systemPrompt,
      messages: anthropicMessages,
      tools: options.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool['input_schema'],
      })),
    });

    const latencyMs = Date.now() - start;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = estimateCost(model, inputTokens, outputTokens);

    log.api.info(
      { model, latencyMs, inputTokens, outputTokens, costUsd: cost.toFixed(6) },
      'Claude chat complete'
    );

    const textContent = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('');

    const toolUses = response.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const tu = b as Anthropic.ToolUseBlock;
        return { type: 'tool_use' as const, id: tu.id, name: tu.name, input: tu.input };
      });

    const stopReason = mapStopReason(response.stop_reason);

    return {
      content: textContent,
      inputTokens,
      outputTokens,
      model: response.model,
      stopReason,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
    };
  }

  async *stream(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? this.model;

    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt =
      options.systemPrompt ??
      (systemMessages.length > 0
        ? systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
        : undefined);

    const anthropicMessages: Anthropic.MessageParam[] = conversationMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as ContentBlock[]).map(mapContentBlock) as Anthropic.MessageParam['content'],
    }));

    try {
      const stream = this.client.messages.stream({
        model,
        max_tokens: options.maxTokens ?? modelMaxTokens(model),
        ...(allowsTemperature(model) && options.temperature !== undefined ? { temperature: options.temperature } : {}),
        system: systemPrompt,
        messages: anthropicMessages,
        tools: options.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool['input_schema'],
        })),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', delta: event.delta.text };
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield {
            type: 'tool_use_start',
            toolUse: { type: 'tool_use', id: event.content_block.id, name: event.content_block.name },
          };
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'input_json_delta'
        ) {
          yield { type: 'tool_use_delta', toolUse: { input: event.delta.partial_json } };
        } else if (event.type === 'message_stop') {
          const finalMsg = await stream.finalMessage();
          const cost = estimateCost(
            model,
            finalMsg.usage.input_tokens,
            finalMsg.usage.output_tokens
          );
          log.api.info(
            {
              model,
              inputTokens: finalMsg.usage.input_tokens,
              outputTokens: finalMsg.usage.output_tokens,
              costUsd: cost.toFixed(6),
            },
            'Claude stream complete'
          );
          yield {
            type: 'done',
            inputTokens: finalMsg.usage.input_tokens,
            outputTokens: finalMsg.usage.output_tokens,
            costUsd: cost,
          };
        }
      }
    } catch (err) {
      const error = friendlyApiError(err);
      log.api.error({ err }, 'Claude stream error');
      yield { type: 'error', error };
    }
  }

  async embed(_text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    throw new Error(
      'Claude does not support embeddings. Use a Voyage, OpenAI, or Ollama embedding provider instead.'
    );
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam;

function mapContentBlock(block: ContentBlock): BlockParam {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' };
  }
  if (block.type === 'image' && block.source) {
    return {
      type: 'image',
      source: {
        type: block.source.type as 'base64' | 'url',
        media_type: (block.source.media_type ?? 'image/png') as Anthropic.ImageBlockParam.Source['media_type'],
        ...(block.source.type === 'base64'
          ? { data: block.source.data ?? '' }
          : { url: block.source.url ?? '' }),
      },
    } as Anthropic.ImageBlockParam;
  }
  if (block.type === 'document' && block.source) {
    // Native Anthropic PDF support (SDK ^0.30)
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: block.source.data ?? '',
      },
    } as unknown as BlockParam;
  }
  if (block.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: block.id ?? '',
      content: block.content as string,
    };
  }
  return { type: 'text', text: '' };
}

function mapStopReason(
  reason: string | null
): ChatResponse['stopReason'] {
  switch (reason) {
    case 'tool_use':   return 'tool_use';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop';
    default:           return 'end_turn';
  }
}
