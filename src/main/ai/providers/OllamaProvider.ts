import type {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  EmbeddingResponse,
} from '../AIProvider';
import { log } from '../../logger';

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama (Local)';
  readonly supportsEmbeddings = true;
  readonly defaultModel = 'llama3.2';
  readonly availableModels: string[] = [];

  private baseUrl: string;
  private model: string;

  constructor(baseUrl = 'http://localhost:11434', model?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model ?? this.defaultModel;
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama tags request failed: ${response.status}`);
    const data = (await response.json()) as OllamaTagsResponse;
    return data.models.map((m) => m.name);
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.model;

    const ollamaMessages: OllamaMessage[] = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: false,
        options: {
          num_predict: options.maxTokens ?? 4096,
          temperature: options.temperature,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama chat failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    const latencyMs = Date.now() - start;
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;

    log.api.info({ model, latencyMs, inputTokens, outputTokens }, 'Ollama chat complete');

    return {
      content: data.message.content,
      inputTokens,
      outputTokens,
      model: data.model,
      stopReason: 'end_turn',
    };
  }

  async *stream(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? this.model;

    const ollamaMessages: OllamaMessage[] = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: true,
          options: {
            num_predict: options.maxTokens ?? 4096,
            temperature: options.temperature,
          },
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        yield { type: 'error', error: `Ollama stream failed (${response.status}): ${text}` };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as OllamaChatResponse;
            if (chunk.message?.content) {
              yield { type: 'text_delta', delta: chunk.message.content };
            }
            if (chunk.done) {
              log.api.info({ model }, 'Ollama stream complete');
              yield { type: 'done' };
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.api.error({ err }, 'Ollama stream error');
      yield { type: 'error', error };
    }
  }

  async embed(text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]> {
    const inputs = Array.isArray(text) ? text : [text];
    const embeddingModel = 'nomic-embed-text';

    const results: EmbeddingResponse[] = [];

    for (const input of inputs) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embeddingModel, prompt: input }),
      });

      if (!response.ok) {
        const text2 = await response.text();
        throw new Error(`Ollama embed failed (${response.status}): ${text2}`);
      }

      const data = (await response.json()) as { embedding: number[] };
      results.push({ embedding: data.embedding, model: embeddingModel, tokenCount: 0 });
    }

    return Array.isArray(text) ? results : results[0];
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as OllamaTagsResponse;
      if (data.models.length === 0) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: 'No models installed. Run: ollama pull llama3.2',
        };
      }
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
