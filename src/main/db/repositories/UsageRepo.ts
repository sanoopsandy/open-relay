import crypto from 'crypto';
import { getDb } from '../database';
import type { TurnTokenData } from '../../ipc/types';

export interface UsageEvent {
  id?: string;
  conversationId?: string;
  model: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  source: 'chat' | 'memory_gen' | 'title_gen';
  turnIndex?: number;
  fullHistoryTokens?: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  memoryGenCount: number;
}

export interface ConversationUsage {
  conversationId: string | null;
  conversationTitle: string;
  date: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  chatRounds: number;
  memoryGenRounds: number;
}

// Recalculate cost at query time — stored cost_usd may reflect stale rates
function costExpr(p = ''): string {
  const m = p ? `${p}.model` : 'model';
  const i = p ? `${p}.input_tokens` : 'input_tokens';
  const o = p ? `${p}.output_tokens` : 'output_tokens';
  return `(CASE ${m}
    WHEN 'claude-opus-4-5'           THEN (${i} * 5.0  + ${o} * 25.0 ) / 1000000.0
    WHEN 'claude-sonnet-4-5'         THEN (${i} * 3.0  + ${o} * 15.0 ) / 1000000.0
    WHEN 'claude-haiku-4-5-20251001' THEN (${i} * 0.25 + ${o} * 1.25 ) / 1000000.0
    ELSE                                  (${i} * 3.0  + ${o} * 15.0 ) / 1000000.0
  END)`;
}

class UsageRepo {
  insert(event: UsageEvent): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_events (id, conversation_id, model, timestamp, input_tokens, output_tokens, cost_usd, source, turn_index, full_history_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id ?? crypto.randomUUID(),
      event.conversationId ?? null,
      event.model,
      event.timestamp,
      event.inputTokens,
      event.outputTokens,
      event.costUsd,
      event.source,
      event.turnIndex ?? 0,
      event.fullHistoryTokens ?? 0,
    );
  }

  summary(since?: number): UsageSummary {
    const db = getDb();
    const where = since ? 'WHERE timestamp >= ?' : '';
    const params = since ? [since] : [];

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)       AS totalIn,
        COALESCE(SUM(output_tokens), 0)      AS totalOut,
        COALESCE(SUM(${costExpr()}), 0)      AS totalCost,
        COALESCE(SUM(CASE WHEN source = 'memory_gen' THEN 1 ELSE 0 END), 0) AS memGenCount,
        COALESCE(SUM(CASE WHEN source = 'chat' AND full_history_tokens > input_tokens
          THEN full_history_tokens - input_tokens ELSE 0 END), 0) AS contextSavedIn,
        CASE WHEN SUM(input_tokens) > 0
          THEN SUM(CASE model
            WHEN 'claude-opus-4-5'           THEN input_tokens * 5.0
            WHEN 'claude-sonnet-4-5'         THEN input_tokens * 3.0
            WHEN 'claude-haiku-4-5-20251001' THEN input_tokens * 0.25
            ELSE                                  input_tokens * 3.0
          END) / SUM(input_tokens)
          ELSE 3.0
        END AS avgInputRatePerM
      FROM usage_events ${where}
    `).get(...params) as { totalIn: number; totalOut: number; totalCost: number; memGenCount: number; contextSavedIn: number; avgInputRatePerM: number };

    const contextSavedCost = (row.contextSavedIn / 1_000_000) * row.avgInputRatePerM;

    return {
      totalInputTokens: row.totalIn,
      totalOutputTokens: row.totalOut,
      totalCostUsd: row.totalCost,
      memoryGenCount: row.memGenCount,
      contextSavedTokens: row.contextSavedIn,
      contextSavedCostUsd: contextSavedCost,
    };
  }

  tokensByTurn(since?: number): TurnTokenData[] {
    const db = getDb();
    const extra = since ? 'AND timestamp >= ?' : '';
    const params = since ? [since] : [];
    const rows = db.prepare(`
      SELECT
        turn_index                           AS turnIndex,
        CAST(AVG(input_tokens) AS INTEGER)   AS avgInputTokens,
        COUNT(*)                             AS sampleCount
      FROM usage_events
      WHERE source = 'chat' AND conversation_id IS NOT NULL AND turn_index > 0 ${extra}
      GROUP BY turn_index
      ORDER BY turn_index
      LIMIT 50
    `).all(...params) as TurnTokenData[];
    return rows;
  }

  byConversation(since?: number): ConversationUsage[] {
    const db = getDb();
    const where = since ? 'WHERE u.timestamp >= ?' : '';
    const params = since ? [since] : [];

    const rows = db.prepare(`
      SELECT
        u.conversation_id                                               AS conversationId,
        COALESCE(c.title, 'Unknown')                                   AS conversationTitle,
        MIN(u.timestamp)                                               AS date,
        COALESCE(SUM(u.input_tokens), 0)                              AS inputTokens,
        COALESCE(SUM(u.output_tokens), 0)                             AS outputTokens,
        COALESCE(SUM(${costExpr('u')}), 0)                            AS costUsd,
        COALESCE(SUM(CASE WHEN u.source = 'chat' THEN 1 ELSE 0 END), 0)       AS chatRounds,
        COALESCE(SUM(CASE WHEN u.source = 'memory_gen' THEN 1 ELSE 0 END), 0) AS memoryGenRounds
      FROM usage_events u
      LEFT JOIN conversations c ON c.id = u.conversation_id
      ${where}
      GROUP BY u.conversation_id
      ORDER BY date DESC
    `).all(...params) as ConversationUsage[];

    return rows;
  }
}

export const usageRepo = new UsageRepo();
