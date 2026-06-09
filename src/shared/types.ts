/**
 * Shared types used by both main and renderer processes.
 * Import from here — never cross the process boundary by importing from src/main.
 */

// ─── Core domain types ────────────────────────────────────────────────────────

export interface HarnessConfig {
  version: number;
  ai: {
    provider: 'claude' | 'openai' | 'gemini' | 'ollama' | 'groq';
    apiKeyCiphertext: string;
    model: string;
    embeddingProvider: 'voyage' | 'openai' | 'ollama';
    embeddingApiKeyCiphertext?: string;
    embeddingModel: string;
    ollama: { baseUrl: string; chatModel: string | null; embeddingModel: string };
    customEndpoint: string | null;
  };
  integrations: {
    jira: { enabled: boolean; siteUrl: string; apiTokenCiphertext: string; email: string };
    github: { enabled: boolean; patCiphertext: string | null };
    slack: { enabled: boolean; teamId: string | null; botTokenCiphertext: string | null };
  };
  personality: {
    prompt: string;
  };
  memory: {
    ttl: {
      browsing: number;
      conversation: number;
      project: number;
      skill: number;
      agent_action: number;
    };
  };
  layout: {
    memoryPaneOpen: boolean;
    sidebarOpen: boolean;
  };
  telemetry: { enabled: boolean; endpoint: string };
  logging: { level: string; remoteEndpoint: string | null };
}

// ─── Usage tracking types ─────────────────────────────────────────────────────

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  memoryGenCount: number;
  contextSavedTokens: number;
  contextSavedCostUsd: number;
}

export interface TurnTokenData {
  turnIndex: number;
  avgInputTokens: number;
  sampleCount: number;
}

export interface ConversationUsage {
  conversationId: string | null;
  conversationTitle: string;
  date: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  chatRounds: number;
  memoryGenRounds: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
  token_count?: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  system_prompt_hash: string;
  messages: Message[];
  sub_agent_ids: string[];
  skill_ids_used: string[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
}

export type CommandHandlerType =
  | { type: 'agent'; agentId: string }
  | { type: 'tool'; toolName: string }
  | { type: 'layout'; action: string }
  | { type: 'memory'; action: 'add' | 'search'; query?: string }
  | { type: 'skill'; skillId: string }
  | { type: 'builtin'; fn: string };

export interface SlashCommand {
  id: string;
  trigger: string;
  description: string;
  source: 'static' | 'mcp';
  mcpServer?: string;
  handler: CommandHandlerType;
}

export interface LayoutState {
  chatPanel: 'visible' | 'floating';
  memoryPaneOpen: boolean;
  sidebarOpen: boolean;
  logViewerOpen: boolean;
}

export interface TimelineEvent {
  id: string;
  event_type: string;
  actor: string;
  title: string;
  detail: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface Artifact {
  id: string;
  name: string;
  language: string;
  content: string;
}

export interface PersistedArtifact extends Artifact {
  conversationId: string;
  messageId: string;
  createdAt: number;
}

export interface Attachment {
  filePath: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface MemoryItem {
  id: string;
  theme: string;
  content: string;
  source: string;
  created_at: number;
}

// ─── Scheduler domain types ───────────────────────────────────────────────────

export interface Scheduler {
  id: string;
  name: string;
  cron_expression: string;
  slack_channel_id: string;
  slack_channel_name: string | null;
  memory_theme: string;
  skill_id: string;
  slack_post_enabled: number; // 0 | 1
  slack_post_channel_id: string | null;
  is_active: number; // 0 | 1
  created_at: string;
}

export interface SchedulerMember {
  id: string;
  scheduler_id: string;
  slack_user_id: string;
  slack_display_name: string;
  created_at: string;
}

export interface SchedulerRun {
  id: string;
  scheduler_id: string;
  skill_id: string;
  triggered_at: string;
  last_pull_at: string | null;
  pull_until: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed';
  output_json: string | null;
  output_summary: string | null;
  error: string | null;
  created_at: string;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackUser {
  id: string;
  displayName: string;
  realName: string;
}

export interface CreateSchedulerDto {
  name: string;
  cron_expression: string;
  slack_channel_id: string;
  slack_channel_name?: string;
  memory_theme: string;
  skill_id: string;
  slack_post_enabled?: number;
  slack_post_channel_id?: string;
}

export interface MemberStatus {
  name: string;
  slack_handle: string;
  flag: 'green' | 'yellow' | 'red' | 'warning';
  reason: string;
  tasks: string[];
  summary: string;
}

export interface SprintAnalysisOutput {
  run_date: string;
  sprint_end: string;
  days_remaining: number;
  members: MemberStatus[];
}

export interface LogLine {
  level: number;
  time: number;
  category: string;
  msg: string;
  [key: string]: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ─── DeepPartial utility ──────────────────────────────────────────────────────

export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

// ─── IPC channel contract ─────────────────────────────────────────────────────

/**
 * Full typed contract for all IPC channels used between renderer and main.
 *
 * Convention:
 *  - invoke channels: renderer calls window.relay.invoke(channel, ...args)
 *  - event channels:  main pushes via webContents.send(channel, payload)
 */
export interface IPC {
  // ── Config ──────────────────────────────────────────────────────────────────
  'config:load': () => Promise<HarnessConfig | null>;
  'config:save': (config: HarnessConfig) => Promise<void>;
  'config:patch': (partial: DeepPartial<HarnessConfig>) => Promise<HarnessConfig>;

  // ── AI / Provider ────────────────────────────────────────────────────────────
  'ai:testConnection': (
    provider: HarnessConfig['ai']['provider'],
    apiKey: string
  ) => Promise<TestConnectionResult>;

  // ── Conversations ────────────────────────────────────────────────────────────
  'chat:createConversation': (systemPrompt?: string) => Promise<string>;
  'chat:sendMessage': (conversationId: string, message: string, attachmentPaths?: string[]) => Promise<void>;
  'chat:getConversation': (conversationId: string) => Promise<Conversation | null>;
  'chat:listConversations': () => Promise<ConversationSummary[]>;
  'chat:deleteConversation': (conversationId: string) => Promise<void>;

  // ── Streaming events (main → renderer) ──────────────────────────────────────
  'stream:delta': { conversationId: string; delta: string };
  'stream:done': { conversationId: string; message: Message };
  'stream:error': { conversationId: string; error: string };

  // ── Artifacts ────────────────────────────────────────────────────────────────
  'artifact:created': { id: string; name: string; language: string };
  'artifact:finalized': { id: string; name: string; language: string; content: string };
  'artifact:download': (dto: { name: string; content: string }) => Promise<void>;
  'artifact:listByConversation': (conversationId: string) => Promise<PersistedArtifact[]>;

  // ── Dialog ───────────────────────────────────────────────────────────────────
  'dialog:openFile': () => Promise<Attachment | null>;
  'dialog:openTextFile': () => Promise<string | null>;

  // ── Commands ─────────────────────────────────────────────────────────────────
  'commands:list': () => Promise<SlashCommand[]>;
  'commands:search': (query: string) => Promise<SlashCommand[]>;
  'commands:resolve': (input: string) => Promise<{ commandId: string; args: string } | null>;
  'commands:dispatch': (commandId: string, args?: string, conversationId?: string) => Promise<void>;

  // ── Layout ───────────────────────────────────────────────────────────────────
  'layout:set': (patch: Partial<LayoutState>) => Promise<void>;
  'layout:changed': LayoutState;

  // ── Onboarding ───────────────────────────────────────────────────────────────
  'onboarding:complete': (config: HarnessConfig) => Promise<void>;
  'onboarding:validateKey': (
    provider: HarnessConfig['ai']['provider'],
    apiKey: string
  ) => Promise<TestConnectionResult>;
  'onboarding:listOllamaModels': () => Promise<string[]>;

  // ── Memory ───────────────────────────────────────────────────────────────────
  'memory:add': (dto: { theme: string; content: string; source?: string }) => Promise<MemoryItem>;
  'memory:listThemes': () => Promise<string[]>;
  'memory:getByTheme': (theme: string) => Promise<MemoryItem[]>;
  'memory:deleteItem': (id: string) => Promise<void>;
  'memory:search': (query: string) => Promise<MemoryItem[]>;
  'memory:itemAdded': MemoryItem;
  'memory:selectTheme': { theme: string };

  // ── Logs ─────────────────────────────────────────────────────────────────────
  'logs:startStreaming': () => Promise<void>;
  'logs:stopStreaming': () => Promise<void>;
  'logs:line': LogLine;
  'logs:getPath': () => Promise<string>;

  // ── Schedulers ───────────────────────────────────────────────────────────────
  'scheduler:list': () => Promise<Scheduler[]>;
  'scheduler:create': (dto: CreateSchedulerDto) => Promise<Scheduler>;
  'scheduler:update': (id: string, patch: Partial<Scheduler>) => Promise<Scheduler>;
  'scheduler:delete': (id: string) => Promise<void>;
  'scheduler:setActive': (id: string, active: boolean) => Promise<void>;
  'scheduler:getMembers': (schedulerId: string) => Promise<SchedulerMember[]>;
  'scheduler:setMembers': (schedulerId: string, members: Array<{ slack_user_id: string; slack_display_name: string }>) => Promise<void>;
  'scheduler:listRuns': (schedulerId: string) => Promise<SchedulerRun[]>;
  'scheduler:triggerManual': (schedulerId: string) => Promise<void>;
  'scheduler:getSlackChannels': () => Promise<SlackChannel[]>;
  'scheduler:getSlackMembers': (channelId: string) => Promise<SlackUser[]>;
  'scheduler:runComplete': { schedulerId: string; runId: string };
  'scheduler:runFailed': { schedulerId: string; runId: string; error: string };

  // ── Skills ───────────────────────────────────────────────────────────────────
  'skills:list': () => Promise<SkillMeta[]>;

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings:updateApiKey': (dto: {
    provider: HarnessConfig['ai']['provider'];
    plainTextKey: string;
    model: string;
  }) => Promise<TestConnectionResult>;
  'settings:updateModel': (dto: { model: string }) => Promise<HarnessConfig>;
  'settings:updateConnector': (dto: {
    connector: 'slack' | 'jira' | 'github';
    enabled: boolean;
    fields: Record<string, string>;
  }) => Promise<void>;

  // ── Usage ────────────────────────────────────────────────────────────────────
  'usage:summary': (since?: number) => Promise<UsageSummary>;
  'usage:byConversation': (since?: number) => Promise<ConversationUsage[]>;
  'usage:tokensByTurn': (since?: number) => Promise<TurnTokenData[]>;
}
