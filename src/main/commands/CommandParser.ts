export interface ParsedCommand {
  trigger: string;
  args: string;
  raw: string;
}

/**
 * Parse a user input string as a slash command.
 * Returns null if the input does not start with `/`.
 *
 * Examples:
 *   "/help" → { trigger: "/help", args: "", raw: "/help" }
 *   "/remember find my meeting notes" → { trigger: "/remember", args: "find my meeting notes", raw: "..." }
 */
export function parse(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { trigger: trimmed, args: '', raw: trimmed };
  }

  const trigger = trimmed.slice(0, spaceIndex);
  const args = trimmed.slice(spaceIndex + 1).trim();
  return { trigger, args, raw: trimmed };
}

/**
 * Returns true if the input looks like a slash command.
 */
export function isCommand(input: string): boolean {
  return input.trim().startsWith('/');
}
