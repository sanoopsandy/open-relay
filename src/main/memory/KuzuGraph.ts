import path from 'path';
import os from 'os';
import { log } from '../logger';

const GRAPH_PATH = path.join(os.homedir(), '.relay', 'graph');

// ─── KuzuGraph ────────────────────────────────────────────────────────────────

interface KuzuQueryResult {
  getAll(): Promise<Record<string, unknown>[]>;
  close(): void;
}

interface KuzuPreparedStatement {
  isSuccess(): boolean;
  getErrorMessage(): string;
}

interface KuzuConnection {
  query(statement: string): Promise<KuzuQueryResult | KuzuQueryResult[]>;
  prepare(statement: string): Promise<KuzuPreparedStatement>;
  execute(ps: KuzuPreparedStatement, params?: Record<string, unknown>): Promise<KuzuQueryResult | KuzuQueryResult[]>;
}

class KuzuGraph {
  private conn: KuzuConnection | null = null;
  private ready = false;

  async init(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const kuzu = require('kuzu') as {
        Database: new (path: string) => unknown;
        Connection: new (db: unknown) => KuzuConnection;
      };
      const db = new kuzu.Database(GRAPH_PATH);
      this.conn = new kuzu.Connection(db);

      const schema = [
        'CREATE NODE TABLE IF NOT EXISTS Turn(id STRING, conversation_id STRING, role STRING, created_at INT64, token_estimate INT64, PRIMARY KEY(id))',
        'CREATE NODE TABLE IF NOT EXISTS MemoryItem(id STRING, theme STRING, created_at INT64, PRIMARY KEY(id))',
        'CREATE NODE TABLE IF NOT EXISTS Entity(name STRING, PRIMARY KEY(name))',
        'CREATE REL TABLE IF NOT EXISTS DISCUSSES(FROM Turn TO Entity)',
        'CREATE REL TABLE IF NOT EXISTS MENTIONS(FROM MemoryItem TO Entity)',
        'CREATE REL TABLE IF NOT EXISTS RELATED_TO(FROM Turn TO MemoryItem, similarity DOUBLE)',
      ];

      for (const stmt of schema) {
        const result = await this.conn.query(stmt);
        const r = Array.isArray(result) ? result[0] : result;
        r.close();
      }

      this.ready = true;
      log.memory.info({ path: GRAPH_PATH }, 'KuzuGraph initialized');
    } catch (err) {
      log.memory.warn({ err }, 'KuzuGraph init failed — graph features disabled');
    }
  }

  // Run a parameterized query via prepare + execute.
  private async exec(statement: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.ready || !this.conn) return;
    try {
      const ps = await this.conn.prepare(statement);
      if (!ps.isSuccess()) {
        log.memory.warn({ err: ps.getErrorMessage() }, 'KuzuGraph prepare failed');
        return;
      }
      const result = await this.conn.execute(ps, params ?? {});
      const r = Array.isArray(result) ? result[0] : result;
      r.close();
    } catch {
      // Silently ignore (duplicate nodes, missing nodes, etc.)
    }
  }

  // Run a raw query string, return all rows.
  private async query(statement: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    if (!this.ready || !this.conn) return [];
    try {
      if (params && Object.keys(params).length > 0) {
        const ps = await this.conn.prepare(statement);
        if (!ps.isSuccess()) return [];
        const result = await this.conn.execute(ps, params);
        const r = Array.isArray(result) ? result[0] : result;
        const rows = await r.getAll();
        r.close();
        return rows;
      }
      const result = await this.conn.query(statement);
      const r = Array.isArray(result) ? result[0] : result;
      const rows = await r.getAll();
      r.close();
      return rows;
    } catch {
      return [];
    }
  }

  async addTurn(id: string, conversationId: string, role: string, createdAt: number, tokenEstimate: number): Promise<void> {
    await this.exec(
      'CREATE (:Turn {id: $id, conversation_id: $convId, role: $role, created_at: $createdAt, token_estimate: $tokenEst})',
      { id, convId: conversationId, role, createdAt, tokenEst: tokenEstimate }
    );
  }

  async addMemoryItem(id: string, theme: string, createdAt: number): Promise<void> {
    await this.exec(
      'CREATE (:MemoryItem {id: $id, theme: $theme, created_at: $createdAt})',
      { id, theme, createdAt }
    );
  }

  async addTurnEntities(turnId: string, entities: string[]): Promise<void> {
    if (!this.ready || entities.length === 0) return;
    for (const raw of entities) {
      const name = raw.toLowerCase().trim().slice(0, 100);
      if (!name || name.length < 2) continue;
      await this.exec('CREATE (:Entity {name: $name})', { name });
      await this.exec(
        'MATCH (t:Turn {id: $tid}), (e:Entity {name: $name}) CREATE (t)-[:DISCUSSES]->(e)',
        { tid: turnId, name }
      );
    }
  }

  async addMemoryEntities(memoryId: string, entities: string[]): Promise<void> {
    if (!this.ready || entities.length === 0) return;
    for (const raw of entities) {
      const name = raw.toLowerCase().trim().slice(0, 100);
      if (!name || name.length < 2) continue;
      await this.exec('CREATE (:Entity {name: $name})', { name });
      await this.exec(
        'MATCH (m:MemoryItem {id: $mid}), (e:Entity {name: $name}) CREATE (m)-[:MENTIONS]->(e)',
        { mid: memoryId, name }
      );
    }
  }

  async linkTurnToMemory(turnId: string, memoryId: string, similarity: number): Promise<void> {
    await this.exec(
      'MATCH (t:Turn {id: $tid}), (m:MemoryItem {id: $mid}) CREATE (t)-[:RELATED_TO {similarity: $sim}]->(m)',
      { tid: turnId, mid: memoryId, sim: similarity }
    );
  }

  async getRelatedMemoryIds(turnIds: string[]): Promise<string[]> {
    if (!this.ready || turnIds.length === 0) return [];
    const allIds = new Set<string>();
    for (const id of turnIds) {
      const rows1 = await this.query(
        'MATCH (t:Turn {id: $id})-[:DISCUSSES]->(e:Entity)<-[:MENTIONS]-(m:MemoryItem) RETURN DISTINCT m.id AS id',
        { id }
      );
      rows1.forEach((r) => { if (r['id']) allIds.add(r['id'] as string); });

      const rows2 = await this.query(
        'MATCH (t:Turn {id: $id})-[:RELATED_TO]->(m:MemoryItem) RETURN DISTINCT m.id AS id',
        { id }
      );
      rows2.forEach((r) => { if (r['id']) allIds.add(r['id'] as string); });
    }
    return [...allIds];
  }

  async getRelatedTurnIds(memoryIds: string[]): Promise<string[]> {
    if (!this.ready || memoryIds.length === 0) return [];
    const allIds = new Set<string>();
    for (const id of memoryIds) {
      const rows = await this.query(
        'MATCH (m:MemoryItem {id: $id})-[:MENTIONS]->(e:Entity)<-[:DISCUSSES]-(t:Turn) RETURN DISTINCT t.id AS id',
        { id }
      );
      rows.forEach((row) => { if (row['id']) allIds.add(row['id'] as string); });
    }
    return [...allIds];
  }
}

export const kuzuGraph = new KuzuGraph();
