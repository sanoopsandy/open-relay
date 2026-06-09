import crypto from 'crypto';
import type { MemoryItem } from '../../ipc/types';
import { getDb } from '../database';
import { log } from '../../logger';

const LAMBDA = 0.05; // recency decay — ~14-day half-life
const TOP_N = 8;
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90-day default TTL for non-manual items

interface MemoryRow {
  id: string;
  theme: string;
  content: string;
  source: string;
  created_at: number;
}

function rowToItem(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    theme: row.theme,
    content: row.content,
    source: row.source,
    created_at: row.created_at,
  };
}

class MemoryRepo {
  insert(theme: string, content: string, source = 'manual'): MemoryItem {
    const db = getDb();
    const createdAt = Date.now();
    // expires_at = 0 means never expires (manual items). Auto-captured items expire after 90 days.
    const expiresAt = source === 'manual' ? 0 : createdAt + TTL_MS;
    const item: MemoryItem = {
      id: crypto.randomUUID(),
      theme: theme.toLowerCase().trim(),
      content,
      source,
      created_at: createdAt,
    };
    try {
      db.prepare(
        'INSERT INTO memory_items (id, theme, content, source, created_at, access_count, expires_at) VALUES (@id, @theme, @content, @source, @created_at, 0, @expires_at)'
      ).run({ ...item, expires_at: expiresAt });
    } catch (err) {
      log.db.error({ err }, 'MemoryRepo.insert failed');
      throw err;
    }
    return item;
  }

  listThemes(): string[] {
    const db = getDb();
    try {
      const rows = db
        .prepare('SELECT DISTINCT theme FROM memory_items ORDER BY theme')
        .all() as Array<{ theme: string }>;
      return rows.map((r) => r.theme);
    } catch (err) {
      log.db.error({ err }, 'MemoryRepo.listThemes failed');
      return [];
    }
  }

  getByTheme(theme: string): MemoryItem[] {
    const db = getDb();
    try {
      const rows = db
        .prepare('SELECT * FROM memory_items WHERE theme = ? ORDER BY created_at DESC')
        .all(theme.toLowerCase().trim()) as MemoryRow[];
      return rows.map(rowToItem);
    } catch (err) {
      log.db.error({ err, theme }, 'MemoryRepo.getByTheme failed');
      return [];
    }
  }

  getById(id: string): MemoryItem | null {
    const db = getDb();
    try {
      const row = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as MemoryRow | undefined;
      return row ? rowToItem(row) : null;
    } catch (err) {
      log.db.error({ err, id }, 'MemoryRepo.getById failed');
      return null;
    }
  }

  deleteItem(id: string): void {
    const db = getDb();
    try {
      db.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
    } catch (err) {
      log.db.error({ err, id }, 'MemoryRepo.deleteItem failed');
      throw err;
    }
  }

  /**
   * FTS5 BM25 search across all themes, scored with recency decay.
   * Returns top-N items most relevant to the query. Increments access_count on returned items.
   */
  search(query: string): MemoryItem[] {
    if (!query.trim()) return [];
    const db = getDb();
    try {
      // Extract keywords: strip FTS5 special chars, drop stop words and short tokens
      const STOP = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','what','which','who','whom','whose','when','where','why','how','this','that','these','those','it','its','with','from','for','and','but','or','nor','not','in','on','at','to','of','by','as','up','out','if','so','yet','both','either','each','few','more','most','other','some','such','than','then','there','they','their','them','we','our','you','your','i','me','my']);
      const safeQuery = query
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()))
        .join(' ')
        .trim();
      if (!safeQuery) return [];

      // Step 1: FTS5 match — get ids and BM25 ranks
      const ftsRows = db
        .prepare(`SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT 20`)
        .all(safeQuery) as Array<{ id: string; rank: number }>;

      if (ftsRows.length === 0) return [];

      // Step 2: fetch full rows from base table
      const rankMap = new Map(ftsRows.map((r) => [r.id, r.rank]));
      const placeholders = ftsRows.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT * FROM memory_items WHERE id IN (${placeholders})`)
        .all(...ftsRows.map((r) => r.id)) as MemoryRow[];

      // Recency decay scoring
      const nowMs = Date.now();
      const scored = rows.map((r) => {
        const rank = rankMap.get(r.id) ?? 0;
        const daysSince = (nowMs - r.created_at) / (1000 * 60 * 60 * 24);
        const score = (-rank) * Math.exp(-LAMBDA * daysSince);
        return { item: rowToItem(r), score };
      });

      scored.sort((a, b) => b.score - a.score);
      const topItems = scored.slice(0, TOP_N).map((s) => s.item);

      // Increment access_count for returned items
      if (topItems.length > 0) {
        const ph = topItems.map(() => '?').join(',');
        db.prepare(`UPDATE memory_items SET access_count = access_count + 1 WHERE id IN (${ph})`)
          .run(...topItems.map((i) => i.id));
      }

      return topItems;
    } catch (err) {
      log.db.error({ err, query }, 'MemoryRepo.search failed');
      return [];
    }
  }

  // Delete expired non-manual memory items. Returns number of rows deleted.
  purgeExpired(): number {
    const db = getDb();
    try {
      const result = db
        .prepare('DELETE FROM memory_items WHERE expires_at > 0 AND expires_at < ?')
        .run(Date.now());
      log.memory.info({ deleted: result.changes }, 'MemoryRepo.purgeExpired complete');
      return result.changes;
    } catch (err) {
      log.db.error({ err }, 'MemoryRepo.purgeExpired failed');
      return 0;
    }
  }
}

export const memoryRepo = new MemoryRepo();
