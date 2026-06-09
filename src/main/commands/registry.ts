import type { SlashCommand } from '../ipc/types';

export const STATIC_COMMANDS: SlashCommand[] = [
  {
    id: 'new-chat',
    trigger: '/new',
    description: 'Start a new conversation',
    source: 'static',
    handler: { type: 'builtin', fn: 'newConversation' },
  },
  {
    id: 'toggle-memory',
    trigger: '/memory',
    description: 'Toggle the memory pane',
    source: 'static',
    handler: { type: 'layout', action: 'toggleMemory' },
  },
  {
    id: 'toggle-logs',
    trigger: '/logs',
    description: 'Open the log viewer',
    source: 'static',
    handler: { type: 'layout', action: 'toggleLogs' },
  },
  {
    id: 'toggle-sidebar',
    trigger: '/sidebar',
    description: 'Toggle the sidebar',
    source: 'static',
    handler: { type: 'layout', action: 'toggleSidebar' },
  },
  {
    id: 'add-to-memory',
    trigger: '/add-to-memory',
    description: 'Save item to memory — /add-to-memory <theme> <content>',
    source: 'static',
    handler: { type: 'memory', action: 'add' },
  },
  {
    id: 'remember',
    trigger: '/remember',
    description: 'Show memory for a theme or search — /remember <theme or query>',
    source: 'static',
    handler: { type: 'memory', action: 'recall' },
  },
  {
    id: 'clear-history',
    trigger: '/clear',
    description: 'Clear current conversation',
    source: 'static',
    handler: { type: 'builtin', fn: 'clearConversation' },
  },
  {
    id: 'help',
    trigger: '/help',
    description: 'Show available commands',
    source: 'static',
    handler: { type: 'builtin', fn: 'showHelp' },
  },
];
