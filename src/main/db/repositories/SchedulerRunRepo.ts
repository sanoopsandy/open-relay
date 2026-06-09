import crypto from 'crypto';
import type { SchedulerRun } from '../../ipc/types';
import { getDb } from '../database';
import { log } from '../../logger';

interface RunRow {
  id: string;
  scheduler_id: string;
  skill_id: string;
  triggered_at: string;
  last_pull_at: string | null;
  pull_until: string | null;
  status: string;
  output_json: string | null;
  output_summary: string | null;
  error: string | null;
  created_at: string;
}

function rowToRun(row: RunRow): SchedulerRun {
  return {
    id: row.id,
    scheduler_id: row.scheduler_id,
    skill_id: row.skill_id,
    triggered_at: row.triggered_at,
    last_pull_at: row.last_pull_at,
    pull_until: row.pull_until,
    status: row.status as SchedulerRun['status'],
    output_json: row.output_json,
    output_summary: row.output_summary,
    error: row.error,
    created_at: row.created_at,
  };
}

class SchedulerRunRepo {
  create(dto: { scheduler_id: string; skill_id: string; triggered_at: string; last_pull_at: string | null }): SchedulerRun {
    const db = getDb();
    const run: SchedulerRun = {
      id: crypto.randomUUID(),
      scheduler_id: dto.scheduler_id,
      skill_id: dto.skill_id,
      triggered_at: dto.triggered_at,
      last_pull_at: dto.last_pull_at,
      pull_until: null,
      status: 'pending',
      output_json: null,
      output_summary: null,
      error: null,
      created_at: new Date().toISOString(),
    };
    try {
      db.prepare(
        `INSERT INTO scheduler_runs
          (id, scheduler_id, skill_id, triggered_at, last_pull_at, pull_until, status, output_json, output_summary, error, created_at)
         VALUES
          (@id, @scheduler_id, @skill_id, @triggered_at, @last_pull_at, @pull_until, @status, @output_json, @output_summary, @error, @created_at)`
      ).run(run);
    } catch (err) {
      log.db.error({ err }, 'SchedulerRunRepo.create failed');
      throw err;
    }
    return run;
  }

  updateStatus(
    id: string,
    status: SchedulerRun['status'],
    patch: Partial<Pick<SchedulerRun, 'output_json' | 'output_summary' | 'error' | 'pull_until'>> = {}
  ): void {
    const db = getDb();
    try {
      db.prepare(
        `UPDATE scheduler_runs
         SET status = @status, output_json = @output_json, output_summary = @output_summary,
             error = @error, pull_until = @pull_until
         WHERE id = @id`
      ).run({
        id,
        status,
        output_json: patch.output_json ?? null,
        output_summary: patch.output_summary ?? null,
        error: patch.error ?? null,
        pull_until: patch.pull_until ?? null,
      });
    } catch (err) {
      log.db.error({ err, id }, 'SchedulerRunRepo.updateStatus failed');
    }
  }

  getLastCompleted(schedulerId: string): SchedulerRun | null {
    const db = getDb();
    try {
      const row = db
        .prepare(
          `SELECT * FROM scheduler_runs
           WHERE scheduler_id = ? AND status = 'complete'
           ORDER BY triggered_at DESC LIMIT 1`
        )
        .get(schedulerId) as RunRow | undefined;
      return row ? rowToRun(row) : null;
    } catch (err) {
      log.db.error({ err, schedulerId }, 'SchedulerRunRepo.getLastCompleted failed');
      return null;
    }
  }

  listByScheduler(schedulerId: string, limit = 20): SchedulerRun[] {
    const db = getDb();
    try {
      const rows = db
        .prepare(
          `SELECT * FROM scheduler_runs WHERE scheduler_id = ? ORDER BY triggered_at DESC LIMIT ?`
        )
        .all(schedulerId, limit) as RunRow[];
      return rows.map(rowToRun);
    } catch (err) {
      log.db.error({ err, schedulerId }, 'SchedulerRunRepo.listByScheduler failed');
      return [];
    }
  }

  getById(id: string): SchedulerRun | null {
    const db = getDb();
    try {
      const row = db.prepare('SELECT * FROM scheduler_runs WHERE id = ?').get(id) as RunRow | undefined;
      return row ? rowToRun(row) : null;
    } catch (err) {
      log.db.error({ err, id }, 'SchedulerRunRepo.getById failed');
      return null;
    }
  }
}

export const schedulerRunRepo = new SchedulerRunRepo();
