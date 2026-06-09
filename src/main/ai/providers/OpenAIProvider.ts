import OpenAI from 'openai';
import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  EmbeddingResponse,
} from '../AIProvider';
import { log } from '../../logger';

export class OpenAIProvider implements AIProvider {
  readonly id: string = 'openai';
  readonly displayName: string = 'OpenAI';
  readonly supportsEmbeddings: boolean = true;
  readonly defaultModel: string = 'gpt-4o';
  readonly availableModels: string[] = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];

  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model ?? this.defaultModel;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.model;

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === 'system') {
        return { role: 'system', content: typeof m.content === 'string' ? m.content : '' };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map((b) =>
              b.type === 'image' && b.source
                ? { type: 'image_url' as const, image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
                : { type: 'text' as const, text: b.text ?? '' }
            ),
      };
    });

    const response = await this.client.chat.completions.create({
      model,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    });

    const latencyMs = Date.now() - start;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    log.api.info({ model, latencyMs, inputTokens, outputTokens }, 'OpenAI chat complete');

    const choice = response.choices[0];
    const content = choice.message.content ?? '';
    const stopReason = mapFinishReason(choice.finish_reason);

    return {
      content,
      inputTokens,
      outputTokens,
      model: response.model,
      stopReason,
    };
  }

  async *stream(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? this.model;

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map((b) =>
            b.type === 'image' && b.source
              ? { type: 'image_url' as const, image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
              : { type: 'text' as const, text: b.text ?? '' }
          ),
    }));

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield { type: 'text_delta', delta };
        }
        if (chunk.choices[0]?.finish_reason) {
          log.api.info({ model }, 'OpenAI stream complete');
          yield { type: 'done' };
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.api.error({ err }, 'OpenAI stream error');
      yield { type: 'error', error };
    }
  }

  async embed(text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    const inputs = Array.isArray(text) ? text : [text];
    const embeddingModel = 'text-embedding-3-small';

    const response = await this.client.embeddings.create({
      model: embeddingModel,
      input: inputs,
    });

    const results: EmbeddingResponse[] = response.data.map((d) => ({
      embedding: d.embedding,
      model: embeddingModel,
      tokenCount: response.usage.prompt_tokens,
    }));

    return Array.isArray(text) ? results : results[0];
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
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

// ─── Groq uses OpenAI-compatible API ─────────────────────────────────────────

export class GroqProvider extends OpenAIProvider {
  override readonly id = 'groq';
  override readonly displayName = 'Groq';
  override readonly supportsEmbeddings = false;
  override readonly defaultModel = 'llama-3.1-70b-versatile';
  override readonly availableModels = [
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ];

  constructor(apiKey: string, model?: string) {
    super(apiKey, model ?? 'llama-3.1-70b-versatile', 'https://api.groq.com/openai/v1');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapFinishReason(reason: string | null): ChatResponse['stopReason'] {
  switch (reason) {
    case 'tool_calls':  return 'tool_use';
    case 'length':      return 'max_tokens';
    case 'stop':        return 'end_turn';
    default:            return 'end_turn';
  }
}
