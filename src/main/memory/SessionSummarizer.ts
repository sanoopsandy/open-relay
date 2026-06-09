import type { AIProvider } from '../ai/AIProvider';
import type { Conversation } from '../ipc/types';
import { getDb } from '../db/database';
import { log } from '../logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const WINDOW_SIZE = 4;       // turns always sent verbatim
const MIN_TOTAL = 8;         // minimum messages before summarizing
const RETRIGGER_EVERY = 4;   // re-summarize every N new messages beyond window

// ─── SessionSummarizer ────────────────────────────────────────────────────────

export async function summarizeIfNeeded(
  conversation: Conversation,
  provider: AIProvider,
  model: string
): Promise<void> {
  const total = conversation.messages.length;

  // Not enough history yet
  if (total < MIN_TOTAL) return;

  // Check trigger condition: every RETRIGGER_EVERY messages after MIN_TOTAL
  if ((total - WINDOW_SIZE) % RETRIGGER_EVERY !== 0) return;

  const db = getDb();
  const toSummarize = total - WINDOW_SIZE; // index of last message to include in summary

  // Check if already summarized up to this point
  const existing = db
    .prepare('SELECT summarized_through_index FROM conversation_summaries WHERE conversation_id = ?')
    .get(conversation.id) as { summarized_through_index: number } | undefined;

  if (existing && existing.summarized_through_index >= toSummarize) return;

  // Build transcript of messages to summarize
  const toInclude = conversation.messages.slice(0, toSummarize);
  const transcript = toInclude
    .filter((m) => !m.content.startsWith('<context>') && !m.content.startsWith('<memory>'))
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 600)}`)
    .join('\n\n');

  if (!transcript.trim()) return;

  try {
    const response = await provider.chat(
      [
        {
          role: 'user',
          content: `Summarize the following conversation excerpt. Focus on: key ideas explored, decisions made, hypotheses formed, and open questions. Be concise (150–250 words). Output ONLY the summary, no preamble.\n\n${transcript}`,
        },
      ],
      { model, maxTokens: 350, temperature: 0.2 }
    );

    const summary = response.content.trim();
    if (!summary) return;

    db.prepare(`
      INSERT INTO conversation_summaries (conversation_id, summary, summarized_through_index, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        summary = excluded.summary,
        summarized_through_index = excluded.summarized_through_index,
        updated_at = excluded.updated_at
    `).run(conversation.id, summary, toSummarize, Date.now());

    log.memory.debug({ conversationId: conversation.id, toSummarize }, 'Session summary updated');
  } catch (err) {
    log.memory.debug({ err }, 'SessionSummarizer: summary generation failed');
  }
}

export function getSessionSummary(conversationId: string): string | null {
  try {
    const row = getDb()
      .prepare('SELECT summary FROM conversation_summaries WHERE conversation_id = ?')
      .get(conversationId) as { summary: string } | undefined;
    return row?.summary ?? null;
  } catch {
    return null;
  }
}
