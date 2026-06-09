import { getDb } from '../db/database';
import { log } from '../logger';

export interface SimilarTurn {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: string;
  contentSnippet: string;
  similarity: number;
  createdAt: number;
  accessCount: number;
}

export interface SimilarMemory {
  memoryId: string;
  similarity: number;
  createdAt: number;
  accessCount: number;
}

export interface TurnRow {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  contentSnippet: string;
  accessCount: number;
  createdAt: number;
}

// ─── Float32Array ↔ SQLite BLOB ──────────────────────────────────────────────

function encode(arr: Float32Array): Buffer {
  const copy = Buffer.allocUnsafe(arr.byteLength);
  Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(copy);
  return copy;
}

function decode(blob: Buffer): Float32Array {
  const copy = Buffer.allocUnsafe(blob.byteLength);
  blob.copy(copy);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── EmbeddingStore ──────────────────────────────────────────────────────────

class EmbeddingStore {
  insertTurn(
    messageId: string,
    conversationId: string,
    conversationTitle: string,
    role: string,
    contentSnippet: string,
    embedding: Float32Array,
    tokenEstimate: number,
    createdAt: number,
    expiresAt: number
  ): void {
    try {
      const db = getDb();

      // ── Deduplication: scan last 20 turns in this conversation ─────────────
      const recent = db
        .prepare(
          'SELECT message_id, embedding FROM turn_embeddings WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20'
        )
        .all(conversationId) as Array<{ message_id: string; embedding: Buffer }>;

      for (const row of recent) {
        const sim = cosineSimilarity(embedding, decode(row.embedding));
        if (sim >= 0.92) {
          db.prepare('UPDATE turn_embeddings SET access_count = access_count + 1 WHERE message_id = ?').run(
            row.message_id
          );
          log.memory.debug(
            { messageId, duplicateOf: row.message_id, sim },
            'EmbeddingStore.insertTurn: dedup hit — incremented existing'
          );
          return;
        }
      }

      // ── Normal insert ──────────────────────────────────────────────────────
      db.prepare(`
        INSERT OR REPLACE INTO turn_embeddings
          (message_id, conversation_id, conversation_title, role,
           content_snippet, embedding, token_estimate, created_at,
           access_count, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        messageId, conversationId, conversationTitle, role,
        contentSnippet, encode(embedding), tokenEstimate, createdAt, expiresAt
      );
    } catch (err) {
      log.db.error({ err, messageId }, 'EmbeddingStore.insertTurn failed');
    }
  }

  insertMemory(memoryId: string, embedding: Float32Array, createdAt: number): void {
    try {
      getDb()
        .prepare('INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, created_at) VALUES (?, ?, ?)')
        .run(memoryId, encode(embedding), createdAt);
    } catch (err) {
      log.db.error({ err, memoryId }, 'EmbeddingStore.insertMemory failed');
    }
  }

  // Returns top-limit turns by cosine similarity, optionally excluding a conversation.
  // Scans the most recent 500 non-expired turn embeddings for performance.
  searchTurns(query: Float32Array, limit: number, excludeConvId?: string): SimilarTurn[] {
    try {
      const now = Date.now();
      const rows = getDb()
        .prepare(`
          SELECT message_id, conversation_id, conversation_title, role,
                 content_snippet, embedding, created_at, access_count
          FROM turn_embeddings
          WHERE (expires_at = 0 OR expires_at > ?)
            ${excludeConvId ? 'AND conversation_id != ?' : ''}
          ORDER BY created_at DESC
          LIMIT 500
        `)
        .all(...(excludeConvId ? [now, excludeConvId] : [now])) as Array<{
          message_id: string;
          conversation_id: string;
          conversation_title: string;
          role: string;
          content_snippet: string;
          embedding: Buffer;
          created_at: number;
          access_count: number;
        }>;

      const scored = rows.map((r) => ({
        messageId: r.message_id,
        conversationId: r.conversation_id,
        conversationTitle: r.conversation_title,
        role: r.role,
        contentSnippet: r.content_snippet,
        similarity: cosineSimilarity(query, decode(r.embedding)),
        createdAt: r.created_at,
        accessCount: r.access_count,
      }));

      scored.sort((a, b) => b.similarity - a.similarity);
      const topResults = scored.slice(0, limit);

      // Increment access_count for returned results
      if (topResults.length > 0) {
        const ph = topResults.map(() => '?').join(',');
        getDb()
          .prepare(`UPDATE turn_embeddings SET access_count = access_count + 1 WHERE message_id IN (${ph})`)
          .run(...topResults.map((t) => t.messageId));
        // [TEMP] log what was retrieved and frequency state
        log.memory.info({
          results: topResults.map((t) => ({
            sim: +t.similarity.toFixed(3),
            freq: t.accessCount,
            role: t.role,
            snippet: t.contentSnippet.slice(0, 80),
          })),
        }, '[TEMP] EmbeddingStore.searchTurns: results + freq');
      }

      return topResults;
    } catch (err) {
      log.db.error({ err }, 'EmbeddingStore.searchTurns failed');
      return [];
    }
  }

  // Returns top-limit memory items by cosine similarity.
  searchMemory(query: Float32Array, limit: number): SimilarMemory[] {
    try {
      const rows = getDb()
        .prepare(`
          SELECT me.memory_id, me.embedding, me.created_at,
                 COALESCE(mi.access_count, 0) AS access_count
          FROM memory_embeddings me
          LEFT JOIN memory_items mi ON mi.id = me.memory_id
          ORDER BY me.created_at DESC
          LIMIT 500
        `)
        .all() as Array<{
          memory_id: string;
          embedding: Buffer;
          created_at: number;
          access_count: number;
        }>;

      const scored = rows.map((r) => ({
        memoryId: r.memory_id,
        similarity: cosineSimilarity(query, decode(r.embedding)),
        createdAt: r.created_at,
        accessCount: r.access_count,
      }));

      scored.sort((a, b) => b.similarity - a.similarity);
      const topResults = scored.slice(0, limit);

      // Increment access_count on memory_items for returned results
      if (topResults.length > 0) {
        const ph = topResults.map(() => '?').join(',');
        getDb()
          .prepare(`UPDATE memory_items SET access_count = access_count + 1 WHERE id IN (${ph})`)
          .run(...topResults.map((m) => m.memoryId));
        // [TEMP] log what memory embeddings were hit
        log.memory.info({
          results: topResults.map((m) => ({
            memoryId: m.memoryId,
            sim: +m.similarity.toFixed(3),
            freq: m.accessCount,
          })),
        }, '[TEMP] EmbeddingStore.searchMemory: results + freq');
      }

      return topResults;
    } catch (err) {
      log.db.error({ err }, 'EmbeddingStore.searchMemory failed');
      return [];
    }
  }

  // Fetch turns with access_count >= minCount that have NOT yet been promoted.
  getTurnsByAccessCount(minCount: number, limit = 100): TurnRow[] {
    try {
      const now = Date.now();
      const rows = getDb()
        .prepare(`
          SELECT te.message_id, te.conversation_id,
                 COALESCE(NULLIF(c.title, 'New Conversation'), te.conversation_title, 'general') AS conversation_title,
                 te.content_snippet, te.access_count, te.created_at
          FROM turn_embeddings te
          LEFT JOIN conversations c ON c.id = te.conversation_id
          WHERE te.access_count >= ?
            AND te.promoted_at = 0
            AND (te.expires_at = 0 OR te.expires_at > ?)
          ORDER BY te.access_count DESC
          LIMIT ?
        `)
        .all(minCount, now, limit) as Array<{
          message_id: string;
          conversation_id: string;
          conversation_title: string;
          content_snippet: string;
          access_count: number;
          created_at: number;
        }>;

      return rows.map((r) => ({
        messageId: r.message_id,
        conversationId: r.conversation_id,
        conversationTitle: r.conversation_title,
        contentSnippet: r.content_snippet,
        accessCount: r.access_count,
        createdAt: r.created_at,
      }));
    } catch (err) {
      log.db.error({ err }, 'EmbeddingStore.getTurnsByAccessCount failed');
      return [];
    }
  }

  // Fetch unpromotd assistant turns from conversations with >= minTurnCount turns.
  // Uses live conversation title from conversations table (not the stale cached value).
  getAssistantTurnsFromSubstantialConversations(minTurnCount: number, limit = 100): TurnRow[] {
    try {
      const now = Date.now();
      const rows = getDb()
        .prepare(`
          SELECT te.message_id, te.conversation_id,
                 COALESCE(NULLIF(c.title, 'New Conversation'), te.conversation_title, 'general') AS conversation_title,
                 te.content_snippet, te.access_count, te.created_at
          FROM turn_embeddings te
          LEFT JOIN conversations c ON c.id = te.conversation_id
          WHERE te.role = 'assistant'
            AND te.promoted_at = 0
            AND (te.expires_at = 0 OR te.expires_at > ?)
            AND (
              SELECT COUNT(*) FROM turn_embeddings t2
              WHERE t2.conversation_id = te.conversation_id
            ) >= ?
          ORDER BY te.created_at DESC
          LIMIT ?
        `)
        .all(now, minTurnCount, limit) as Array<{
          message_id: string;
          conversation_id: string;
          conversation_title: string;
          content_snippet: string;
          access_count: number;
          created_at: number;
        }>;

      return rows.map((r) => ({
        messageId: r.message_id,
        conversationId: r.conversation_id,
        conversationTitle: r.conversation_title,
        contentSnippet: r.content_snippet,
        accessCount: r.access_count,
        createdAt: r.created_at,
      }));
    } catch (err) {
      log.db.error({ err }, 'EmbeddingStore.getAssistantTurnsFromSubstantialConversations failed');
      return [];
    }
  }

  // Mark a turn as promoted so it won't be re-promoted in future runs.
  markPromoted(messageId: string): void {
    try {
      getDb()
        .prepare('UPDATE turn_embeddings SET promoted_at = ? WHERE message_id = ?')
        .run(Date.now(), messageId);
    } catch (err) {
      log.db.error({ err, messageId }, 'EmbeddingStore.markPromoted failed');
    }
  }

  // Delete expired turn embeddings. Returns number of rows deleted.
  purgeExpiredTurns(): number {
    try {
      const result = getDb()
        .prepare('DELETE FROM turn_embeddings WHERE expires_at > 0 AND expires_at < ?')
        .run(Date.now());
      return result.changes;
    } catch (err) {
      log.db.error({ err }, 'EmbeddingStore.purgeExpiredTurns failed');
      return 0;
    }
  }
}

export const embeddingStore = new EmbeddingStore();
