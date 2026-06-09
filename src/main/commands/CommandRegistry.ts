import type { SlashCommand } from '../ipc/types';
import { STATIC_COMMANDS } from './registry';

class CommandRegistry {
  private commands = new Map<string, SlashCommand>();

  constructor() {
    this.registerMany(STATIC_COMMANDS);
  }

  register(command: SlashCommand): void {
    this.commands.set(command.id, command);
  }

  registerMany(commands: SlashCommand[]): void {
    for (const cmd of commands) {
      this.register(cmd);
    }
  }

  unregisterBySource(source: SlashCommand['source'], mcpServer?: string): void {
    for (const [id, cmd] of this.commands) {
      if (cmd.source === source) {
        if (mcpServer === undefined || cmd.mcpServer === mcpServer) {
          this.commands.delete(id);
        }
      }
    }
  }

  find(id: string): SlashCommand | undefined {
    return this.commands.get(id);
  }

  findByTrigger(trigger: string): SlashCommand | undefined {
    const normalized = trigger.startsWith('/') ? trigger : `/${trigger}`;
    for (const cmd of this.commands.values()) {
      if (cmd.trigger === normalized) return cmd;
    }
    return undefined;
  }

  search(query: string): SlashCommand[] {
    if (!query) return Array.from(this.commands.values());
    const q = query.toLowerCase().replace(/^\//, '');
    return Array.from(this.commands.values()).filter(
      (cmd) =>
        cmd.trigger.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
    );
  }

  list(): SlashCommand[] {
    return Array.from(this.commands.values());
  }
}

export const commandRegistry = new CommandRegistry();
