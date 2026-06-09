-- Harness SQLite schema v2
-- WAL mode and foreign keys are set programmatically before executing this.

CREATE TABLE IF NOT EXISTS conversations (
  id                 TEXT    PRIMARY KEY,
  title              TEXT    NOT NULL DEFAULT 'New Conversation',
  model              TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  system_prompt_hash TEXT    NOT NULL DEFAULT '',
  messages           TEXT    NOT NULL DEFAULT '[]',
  sub_agent_ids      TEXT    NOT NULL DEFAULT '[]',
  skill_ids_used     TEXT    NOT NULL DEFAULT '[]',
  archived_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS timeline_events (
  id          TEXT    PRIMARY KEY,
  event_type  TEXT    NOT NULL,
  actor       TEXT    NOT NULL DEFAULT 'system',
  title       TEXT    NOT NULL,
  detail      TEXT    NOT NULL DEFAULT '',
  entity_type TEXT    NOT NULL DEFAULT '',
  entity_id   TEXT    NOT NULL DEFAULT '',
  metadata    TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timeline_created ON timeline_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_type    ON timeline_events(event_type);

CREATE VIRTUAL TABLE IF NOT EXISTS timeline_fts USING fts5(
  title, detail, content=timeline_events, content_rowid=rowid
);

CREATE TABLE IF NOT EXISTS memory_items (
  id           TEXT    PRIMARY KEY,
  theme        TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'manual',
  created_at   INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  expires_at   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memory_theme   ON memory_items(theme);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_items(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  id      UNINDEXED,
  theme   UNINDEXED,
  content,
  content='memory_items',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_fts_ins AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_fts(rowid, id, theme, content)
  VALUES (new.rowid, new.id, new.theme, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_del AFTER DELETE ON memory_items BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, id, theme, content)
  VALUES ('delete', old.rowid, old.id, old.theme, old.content);
END;

CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL,
  message_id      TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  language        TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id, created_at);

-- ─── Scheduler tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schedulers (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  cron_expression      TEXT NOT NULL,
  slack_channel_id     TEXT NOT NULL,
  slack_channel_name   TEXT,
  memory_theme         TEXT NOT NULL,
  skill_id             TEXT NOT NULL DEFAULT 'sprint-analysis',
  slack_post_enabled   INTEGER NOT NULL DEFAULT 0,
  slack_post_channel_id TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduler_members (
  id                   TEXT PRIMARY KEY,
  scheduler_id         TEXT NOT NULL REFERENCES schedulers(id) ON DELETE CASCADE,
  slack_user_id        TEXT NOT NULL,
  slack_display_name   TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id                   TEXT PRIMARY KEY,
  scheduler_id         TEXT NOT NULL REFERENCES schedulers(id) ON DELETE CASCADE,
  skill_id             TEXT NOT NULL,
  triggered_at         TEXT NOT NULL,
  last_pull_at         TEXT,
  pull_until           TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  output_json          TEXT,
  output_summary       TEXT,
  error                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_scheduler ON scheduler_runs(scheduler_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_members_scheduler ON scheduler_members(scheduler_id);

-- ─── Usage tracking ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_events (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT,
  model           TEXT    NOT NULL,
  timestamp       INTEGER NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL    NOT NULL DEFAULT 0,
  source          TEXT    NOT NULL  -- 'chat' | 'memory_gen' | 'title_gen'
);

CREATE INDEX IF NOT EXISTS idx_usage_conversation ON usage_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp    ON usage_events(timestamp DESC);

-- ─── GraphRAG tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS turn_embeddings (
  message_id         TEXT    PRIMARY KEY,
  conversation_id    TEXT    NOT NULL,
  conversation_title TEXT    NOT NULL DEFAULT '',
  role               TEXT    NOT NULL DEFAULT 'user',
  content_snippet    TEXT    NOT NULL DEFAULT '',
  embedding          BLOB    NOT NULL,
  token_estimate     INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  access_count       INTEGER NOT NULL DEFAULT 0,
  expires_at         INTEGER NOT NULL DEFAULT 0,
  promoted_at        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_turn_emb_conv ON turn_embeddings(conversation_id);
CREATE INDEX IF NOT EXISTS idx_turn_emb_ts   ON turn_embeddings(created_at DESC);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id  TEXT    PRIMARY KEY,
  embedding  BLOB    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  conversation_id          TEXT    PRIMARY KEY,
  summary                  TEXT    NOT NULL,
  summarized_through_index INTEGER NOT NULL DEFAULT 0,
  updated_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  type        TEXT    NOT NULL DEFAULT 'prompt_chain',
  version     TEXT    NOT NULL DEFAULT '1.0.0',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  author      TEXT    NOT NULL DEFAULT 'user',
  path        TEXT    NOT NULL,
  inputs      TEXT    NOT NULL DEFAULT '[]',
  run_count   INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  tags        TEXT    NOT NULL DEFAULT '[]'
);
