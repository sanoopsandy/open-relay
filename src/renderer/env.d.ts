/// <reference types="vite/client" />

/**
 * Type declarations for the window.relay IPC bridge injected by the preload script.
 * Keep in sync with src/preload/index.ts
 */

type InvokeChannel =
  | 'config:load'
  | 'config:save'
  | 'config:patch'
  | 'ai:testConnection'
  | 'chat:createConversation'
  | 'chat:sendMessage'
  | 'chat:getConversation'
  | 'chat:listConversations'
  | 'chat:deleteConversation'
  | 'commands:list'
  | 'commands:search'
  | 'commands:dispatch'
  | 'layout:set'
  | 'onboarding:complete'
  | 'onboarding:validateKey'
  | 'onboarding:listOllamaModels'
  | 'logs:startStreaming'
  | 'logs:stopStreaming'
  | 'logs:getPath';

type EventChannel =
  | 'stream:delta'
  | 'stream:done'
  | 'stream:error'
  | 'layout:changed'
  | 'layout:command'
  | 'logs:line'
  | 'chat:newConversation'
  | 'chat:clearConversation'
  | 'chat:systemMessage'
  | 'memory:itemAdded'
  | 'memory:selectTheme'
  | 'artifact:created'
  | 'artifact:finalized'
  | 'scheduler:runComplete'
  | 'scheduler:runFailed'
  | 'conversation:titleUpdated';

interface HarnessIPC {
  invoke<T = unknown>(channel: InvokeChannel, ...args: unknown[]): Promise<T>;
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void;
  once(channel: EventChannel, listener: (payload: unknown) => void): void;
  off(channel: EventChannel, listener: (payload: unknown) => void): void;
}

declare interface Window {
  harness: HarnessIPC;
}
