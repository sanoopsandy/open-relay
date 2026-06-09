import type { Conversation, ConversationSummary, Message } from '../../ipc/types';
import { getDb } from '../database';

// ─── Raw row types ────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  system_prompt_hash: string;
  messages: string;
  sub_agent_ids: string;
  skill_ids_used: string;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    created_at: row.created_at,
    updated_at: row.updated_at,
    system_prompt_hash: row.system_prompt_hash,
    messages: JSON.parse(row.messages) as Message[],
    sub_agent_ids: JSON.parse(row.sub_agent_ids) as string[],
    skill_ids_used: JSON.parse(row.skill_ids_used) as string[],
  };
}

// ─── ConversationRepo ─────────────────────────────────────────────────────────

class ConversationRepo {
  insert(conv: Omit<Conversation, 'messages'> & { messages: Message[] }): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO conversations
        (id, title, model, created_at, updated_at, system_prompt_hash, messages, sub_agent_ids, skill_ids_used)
      VALUES
        (@id, @title, @model, @created_at, @updated_at, @system_prompt_hash, @messages, @sub_agent_ids, @skill_ids_used)
    `);
    stmt.run({
      id: conv.id,
      title: conv.title,
      model: conv.model,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      system_prompt_hash: conv.system_prompt_hash,
      messages: JSON.stringify(conv.messages),
      sub_agent_ids: JSON.stringify(conv.sub_agent_ids),
      skill_ids_used: JSON.stringify(conv.skill_ids_used),
    });
  }

  update(id: string, patch: Partial<Conversation>): void {
    const db = getDb();
    const current = this.findById(id);
    if (!current) throw new Error(`Conversation ${id} not found`);

    const merged = { ...current, ...patch, updated_at: Date.now() };

    const stmt = db.prepare(`
      UPDATE conversations SET
        title              = @title,
        model              = @model,
        updated_at         = @updated_at,
        system_prompt_hash = @system_prompt_hash,
        messages           = @messages,
        sub_agent_ids      = @sub_agent_ids,
        skill_ids_used     = @skill_ids_used
      WHERE id = @id
    `);
    stmt.run({
      id,
      title: merged.title,
      model: merged.model,
      updated_at: merged.updated_at,
      system_prompt_hash: merged.system_prompt_hash,
      messages: JSON.stringify(merged.messages),
      sub_agent_ids: JSON.stringify(merged.sub_agent_ids),
      skill_ids_used: JSON.stringify(merged.skill_ids_used),
    });
  }

  findById(id: string): Conversation | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined;
    return row ? rowToConversation(row) : null;
  }

  list(): ConversationSummary[] {
    const db = getDb();
    const rows = db
      .prepare(
        'SELECT id, title, model, created_at, updated_at FROM conversations WHERE archived_at IS NULL ORDER BY updated_at DESC'
      )
      .all() as ConversationSummary[];
    return rows;
  }

  archive(id: string): void {
    const db = getDb();
    const now = Date.now();
    db.prepare('UPDATE conversations SET archived_at = ? WHERE id = ?').run(now, id);
    // Purge archives older than 90 days
    const cutoff = now - 90 * 24 * 60 * 60 * 1000;
    db.prepare('DELETE FROM conversations WHERE archived_at IS NOT NULL AND archived_at < ?').run(cutoff);
  }

  /** @deprecated Use archive() — kept for callers that haven't migrated */
  delete(id: string): void {
    this.archive(id);
  }

  appendMessage(conversationId: string, message: Message): void {
    const db = getDb();

    // Use a transaction for read-modify-write safety
    const tx = db.transaction(() => {
      const row = db
        .prepare('SELECT messages FROM conversations WHERE id = ?')
        .get(conversationId) as Pick<ConversationRow, 'messages'> | undefined;

      if (!row) throw new Error(`Conversation ${conversationId} not found`);

      const messages: Message[] = JSON.parse(row.messages);
      messages.push(message);

      db.prepare(
        'UPDATE conversations SET messages = @messages, updated_at = @updated_at WHERE id = @id'
      ).run({
        id: conversationId,
        messages: JSON.stringify(messages),
        updated_at: Date.now(),
      });
    });

    tx();
  }

  /**
   * Update the title of a conversation (e.g., derived from first message).
   */
  updateTitle(id: string, title: string): void {
    const db = getDb();
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      title,
      Date.now(),
      id
    );
  }
}

export const conversationRepo = new ConversationRepo();
