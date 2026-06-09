import { contextBridge, ipcRenderer } from 'electron';

// ─── Allowed channels ─────────────────────────────────────────────────────────

const INVOKE_CHANNELS = [
  'config:load',
  'config:save',
  'config:patch',
  'ai:testConnection',
  'chat:createConversation',
  'chat:sendMessage',
  'chat:getConversation',
  'chat:listConversations',
  'chat:deleteConversation',
  'commands:list',
  'commands:search',
  'commands:resolve',
  'commands:dispatch',
  'layout:set',
  'onboarding:complete',
  'onboarding:validateKey',
  'onboarding:listOllamaModels',
  'logs:startStreaming',
  'logs:stopStreaming',
  'logs:getPath',
  'memory:add',
  'memory:listThemes',
  'memory:getByTheme',
  'memory:deleteItem',
  'memory:search',
  'dialog:openFile',
  'artifact:download',
  'artifact:listByConversation',
  'scheduler:list',
  'scheduler:create',
  'scheduler:update',
  'scheduler:delete',
  'scheduler:setActive',
  'scheduler:getMembers',
  'scheduler:setMembers',
  'scheduler:listRuns',
  'scheduler:triggerManual',
  'scheduler:getSlackChannels',
  'scheduler:getSlackMembers',
  'skills:list',
  'settings:updateApiKey',
  'settings:updateModel',
  'settings:updateConnector',
  'settings:updateEmbeddingKey',
  'usage:summary',
  'usage:byConversation',
  'usage:tokensByTurn',
  'dialog:openTextFile',
] as const;

const EVENT_CHANNELS = [
  'stream:delta',
  'stream:done',
  'stream:error',
  'layout:changed',
  'layout:command',
  'logs:line',
  'chat:newConversation',
  'chat:clearConversation',
  'chat:systemMessage',
  'memory:itemAdded',
  'memory:selectTheme',
  'artifact:created',
  'artifact:finalized',
  'scheduler:runComplete',
  'scheduler:runFailed',
  'conversation:titleUpdated',
  'config:updated',
] as const;

type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
type EventChannel = (typeof EVENT_CHANNELS)[number];

// ─── Type-safe IPC bridge ─────────────────────────────────────────────────────

const relay = {
  /**
   * Invoke a main-process handler and await the result.
   */
  invoke<T = unknown>(channel: InvokeChannel, ...args: unknown[]): Promise<T> {
    if (!INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Blocked invoke channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },

  /**
   * Subscribe to a push event from the main process.
   * Returns an unsubscribe function.
   */
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void {
    if (!EVENT_CHANNELS.includes(channel)) {
      console.warn(`[preload] Blocked event channel: ${channel}`);
      return () => {};
    }
    const wrapper = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapper);
    return () => ipcRenderer.removeListener(channel, wrapper);
  },

  /**
   * Subscribe to a push event, fire once, then auto-unsubscribe.
   */
  once(channel: EventChannel, listener: (payload: unknown) => void): void {
    if (!EVENT_CHANNELS.includes(channel)) {
      console.warn(`[preload] Blocked once channel: ${channel}`);
      return;
    }
    ipcRenderer.once(channel, (_event, payload) => listener(payload));
  },

  /**
   * Remove a specific listener from a channel.
   */
  off(channel: EventChannel, listener: (payload: unknown) => void): void {
    ipcRenderer.removeListener(channel, listener as Parameters<typeof ipcRenderer.removeListener>[1]);
  },
};

contextBridge.exposeInMainWorld('relay', relay);

// ─── Type declaration for renderer ───────────────────────────────────────────

declare global {
  interface Window {
    relay: typeof relay;
  }
}
