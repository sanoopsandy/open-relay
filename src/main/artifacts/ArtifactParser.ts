// Detects named fenced code blocks in accumulated stream text.
// A "named" fence is one whose info string contains a filename with an extension:
//   ```python chart.py
//   ...
//   ```
// Generic fences (```python, ```js) are ignored — they stay in the chat only.

export interface ArtifactEvent {
  type: 'created' | 'delta' | 'finalized';
  id: string;
  name: string;
  language: string;
  content: string;
}

interface TrackedArtifact {
  id: string;
  name: string;
  language: string;
  contentStart: number;
  notifiedCreated: boolean;
  finalized: boolean;
  lastDeltaLen: number; // content length at last delta emission
}

// Send a delta every DELTA_INTERVAL characters to avoid flooding the renderer
const DELTA_INTERVAL = 300;

// Matches: ```lang filename.ext (filename must contain a dot)
const OPENING = /^```(\w+)\s+(\S+\.\S+)\s*$/gm;
// Matches a bare closing fence on its own line
const CLOSING = /^```\s*$/m;

export class ArtifactParser {
  private tracked = new Map<number, TrackedArtifact>();

  feed(accumulated: string): ArtifactEvent[] {
    const events: ArtifactEvent[] = [];
    OPENING.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = OPENING.exec(accumulated)) !== null) {
      const pos = match.index;
      const language = match[1];
      const name = match[2];
      // +1 for the newline after the opening fence line
      const contentStart = pos + match[0].length + 1;

      if (!this.tracked.has(pos)) {
        this.tracked.set(pos, {
          id: `art-${pos}`,
          name,
          language,
          contentStart,
          notifiedCreated: false,
          finalized: false,
          lastDeltaLen: 0,
        });
      }

      const entry = this.tracked.get(pos)!;
      if (entry.finalized) continue;

      const rest = accumulated.slice(entry.contentStart);
      const closingMatch = CLOSING.exec(rest);

      if (closingMatch) {
        const content = rest.slice(0, closingMatch.index).replace(/\n$/, '');
        entry.finalized = true;
        events.push({ type: 'finalized', id: entry.id, name: entry.name, language: entry.language, content });
      } else if (!entry.notifiedCreated) {
        entry.notifiedCreated = true;
        entry.lastDeltaLen = 0;
        events.push({ type: 'created', id: entry.id, name: entry.name, language: entry.language, content: '' });
      } else if (rest.length - entry.lastDeltaLen >= DELTA_INTERVAL) {
        // Throttled live update so the user can see progress
        entry.lastDeltaLen = rest.length;
        events.push({ type: 'delta', id: entry.id, name: entry.name, language: entry.language, content: rest });
      }
    }

    return events;
  }

  // Call when the stream ends — finalizes any artifact that never got a closing fence.
  flush(accumulated: string): ArtifactEvent[] {
    const events: ArtifactEvent[] = [];
    for (const entry of this.tracked.values()) {
      if (entry.finalized || !entry.notifiedCreated) continue;
      const content = accumulated.slice(entry.contentStart).replace(/\n$/, '');
      entry.finalized = true;
      events.push({ type: 'finalized', id: entry.id, name: entry.name, language: entry.language, content });
    }
    return events;
  }

  reset(): void {
    this.tracked.clear();
  }
}
