import type { WebContents } from 'electron';
import type { SlashCommand, LayoutState } from '../ipc/types';
import { commandRegistry } from './CommandRegistry';
import { memoryRepo } from '../db/repositories/MemoryRepo';
import { agentRunner } from '../agent/AgentRunner';
import { log } from '../logger';

// ─── CommandDispatcher ────────────────────────────────────────────────────────

export async function dispatch(
  commandId: string,
  args: string = '',
  webContents: WebContents,
  conversationId?: string
): Promise<void> {
  const command = commandRegistry.find(commandId);
  if (!command) {
    log.agent.warn({ commandId }, 'Command not found');
    return;
  }

  log.agent.info({ commandId, trigger: command.trigger, args }, 'Dispatching command');

  const { handler } = command;

  switch (handler.type) {
    case 'layout': {
      await dispatchLayout(handler.action, webContents);
      break;
    }
    case 'builtin': {
      await dispatchBuiltin(handler.fn, args, webContents);
      break;
    }
    case 'agent': {
      // Week 1 stub — agent dispatch wired in Week 2
      log.agent.info({ agentId: handler.agentId, args }, 'stub: agent dispatch');
      break;
    }
    case 'tool': {
      // Week 1 stub — MCP tool dispatch wired in Week 3
      log.agent.info({ toolName: handler.toolName, args }, 'stub: tool dispatch');
      break;
    }
    case 'memory': {
      await dispatchMemory(handler.action, args, webContents, conversationId);
      break;
    }
    case 'skill': {
      // Week 1 stub — skill execution wired in Week 4
      log.agent.info({ skillId: handler.skillId, args }, 'stub: skill dispatch');
      break;
    }
    default: {
      log.agent.warn({ handler }, 'Unknown command handler type');
    }
  }
}

// ─── Layout dispatch ──────────────────────────────────────────────────────────

async function dispatchLayout(action: string, webContents: WebContents): Promise<void> {
  // We push a layout:changed event that the renderer reacts to.
  // The renderer's layoutStore handles the actual state change.
  if (!webContents.isDestroyed()) {
    webContents.send('layout:command', { action });
  }
  log.agent.info({ action }, 'Layout command dispatched');
}

// ─── Memory dispatch ──────────────────────────────────────────────────────────

async function dispatchMemory(
  action: string,
  args: string,
  webContents: WebContents,
  conversationId?: string
): Promise<void> {
  if (action === 'recall') {
    const query = args.trim();
    if (!query) {
      if (!webContents.isDestroyed()) {
        webContents.send('chat:systemMessage', {
          content:
            'Usage: /remember <theme or search query>\nExample: /remember business\nExample: /remember RFP deadline',
        });
      }
      return;
    }

    try {
      const themes = memoryRepo.listThemes();
      const theme = themes.find((t) => t.toLowerCase() === query.toLowerCase());

      if (theme) {
        const items = memoryRepo.getByTheme(theme);
        const lines = items.map((item) => `• ${item.content}`).join('\n');
        if (!webContents.isDestroyed()) {
          webContents.send('layout:command', { action: 'openMemory' });
          webContents.send('memory:selectTheme', { theme });
          webContents.send('chat:systemMessage', {
            content:
              items.length > 0
                ? `**${theme}** (${items.length} item${items.length === 1 ? '' : 's'}):\n${lines}`
                : `No items in **${theme}** yet. Use /add-to-memory ${theme} <content> to add one.`,
          });
        }
        log.memory.info({ theme, count: items.length }, 'Memory recalled by theme');
        return;
      }

      const hits = memoryRepo.search(query);
      if (!webContents.isDestroyed()) {
        if (hits.length === 0) {
          webContents.send('chat:systemMessage', {
            content: `No memory items matched "${query}". Available themes: ${themes.length > 0 ? themes.join(', ') : '(none)'}`,
          });
        } else {
          const lines = hits.map((item) => `• [${item.theme}] ${item.content}`).join('\n');
          webContents.send('chat:systemMessage', {
            content: `Found ${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}":\n${lines}`,
          });
        }
      }
      log.memory.info({ query, count: hits.length }, 'Memory recalled by search');
    } catch (err) {
      log.memory.error({ err }, 'Failed to recall memory');
      if (!webContents.isDestroyed()) {
        webContents.send('chat:systemMessage', { content: 'Failed to search memory.' });
      }
    }
    return;
  }

  // 'add' is now handled by AgentRunner.handleAddToMemory via chat:sendMessage
}

// ─── Builtin dispatch ─────────────────────────────────────────────────────────

async function dispatchBuiltin(
  fn: string,
  args: string,
  webContents: WebContents
): Promise<void> {
  switch (fn) {
    case 'newConversation': {
      if (!webContents.isDestroyed()) {
        webContents.send('chat:newConversation', {});
      }
      break;
    }
    case 'clearConversation': {
      if (!webContents.isDestroyed()) {
        webContents.send('chat:clearConversation', {});
      }
      break;
    }
    case 'showHelp': {
      const commands = commandRegistry.list();
      const helpText = commands
        .map((cmd: SlashCommand) => `${cmd.trigger} — ${cmd.description}`)
        .join('\n');
      if (!webContents.isDestroyed()) {
        webContents.send('chat:systemMessage', { content: `Available commands:\n\n${helpText}` });
      }
      break;
    }
    default: {
      log.agent.info({ fn, args }, 'stub: builtin dispatch');
    }
  }
}
