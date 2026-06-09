// ─── Shared types for all AI providers ───────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'document';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
  toolUses?: ContentBlock[];
}

export interface StreamChunk {
  type: 'text_delta' | 'tool_use_start' | 'tool_use_delta' | 'done' | 'error';
  delta?: string;
  toolUse?: Partial<ContentBlock>;
  error?: string;
  // populated on type='done'
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  tokenCount: number;
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsEmbeddings: boolean;
  readonly defaultModel: string;
  readonly availableModels: string[];

  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk>;
  embed(text: string | string[]): Promise<EmbeddingResponse | EmbeddingResponse[]>;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}
