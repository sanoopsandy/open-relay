import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../logger';

// ─── Paths ────────────────────────────────────────────────────────────────────

const DB_PATH = path.join(os.homedir(), '.relay', 'db', 'relay.db');

// Try __dirname-relative first (works in prod), then fall back to src tree (dev)
function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, 'schema.sql'),                                          // prod
    path.join(__dirname, '..', '..', 'src', 'main', 'db', 'schema.sql'),        // dev via ts-node
    path.join(process.cwd(), 'src', 'main', 'db', 'schema.sql'),                // cwd fallback
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`schema.sql not found. Tried:\n${candidates.join('\n')}`);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}

export function initDatabase(): void {
  if (_db) return;

  // Ensure directory exists
  const dbDir = path.dirname(DB_PATH);
  fs.mkdirSync(dbDir, { recursive: true });

  _db = new Database(DB_PATH);

  // Performance & safety pragmas
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('cache_size = -32000'); // 32 MB

  // Apply schema
  const schemaPath = resolveSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf8');
  _db.exec(schema);

  // Migrations — ALTER TABLE throws if column exists; that's fine
  try { _db.exec('ALTER TABLE conversations ADD COLUMN archived_at INTEGER'); } catch { /* already exists */ }
  try { _db.exec('ALTER TABLE usage_events ADD COLUMN turn_index INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.exec('ALTER TABLE usage_events ADD COLUMN full_history_tokens INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  // Auto-memory layer migrations
  try { _db.exec('ALTER TABLE turn_embeddings ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.exec('ALTER TABLE turn_embeddings ADD COLUMN expires_at   INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.exec('ALTER TABLE memory_items    ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.exec('ALTER TABLE memory_items    ADD COLUMN expires_at   INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { _db.exec('ALTER TABLE turn_embeddings ADD COLUMN promoted_at INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  // Indexes on new columns — must run after ALTER TABLE so the columns exist
  try { _db.exec('CREATE INDEX IF NOT EXISTS idx_turn_emb_expires ON turn_embeddings(expires_at)'); } catch { /* already exists */ }
  try { _db.exec('CREATE INDEX IF NOT EXISTS idx_memory_expires   ON memory_items(expires_at)');    } catch { /* already exists */ }

  log.db.info({ path: DB_PATH }, 'Database opened');
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    log.db.info('Database closed');
  }
}
