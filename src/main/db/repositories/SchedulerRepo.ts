import crypto from 'crypto';
import type { Scheduler, SchedulerMember, CreateSchedulerDto } from '../../ipc/types';
import { getDb } from '../database';
import { log } from '../../logger';

interface SchedulerRow {
  id: string;
  name: string;
  cron_expression: string;
  slack_channel_id: string;
  slack_channel_name: string | null;
  memory_theme: string;
  skill_id: string;
  slack_post_enabled: number;
  slack_post_channel_id: string | null;
  is_active: number;
  created_at: string;
}

interface MemberRow {
  id: string;
  scheduler_id: string;
  slack_user_id: string;
  slack_display_name: string;
  created_at: string;
}

function rowToScheduler(row: SchedulerRow): Scheduler {
  return {
    id: row.id,
    name: row.name,
    cron_expression: row.cron_expression,
    slack_channel_id: row.slack_channel_id,
    slack_channel_name: row.slack_channel_name,
    memory_theme: row.memory_theme,
    skill_id: row.skill_id,
    slack_post_enabled: row.slack_post_enabled,
    slack_post_channel_id: row.slack_post_channel_id,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

function rowToMember(row: MemberRow): SchedulerMember {
  return {
    id: row.id,
    scheduler_id: row.scheduler_id,
    slack_user_id: row.slack_user_id,
    slack_display_name: row.slack_display_name,
    created_at: row.created_at,
  };
}

class SchedulerRepo {
  create(dto: CreateSchedulerDto): Scheduler {
    const db = getDb();
    const item: Scheduler = {
      id: crypto.randomUUID(),
      name: dto.name,
      cron_expression: dto.cron_expression,
      slack_channel_id: dto.slack_channel_id,
      slack_channel_name: dto.slack_channel_name ?? null,
      memory_theme: dto.memory_theme,
      skill_id: dto.skill_id,
      slack_post_enabled: dto.slack_post_enabled ?? 0,
      slack_post_channel_id: dto.slack_post_channel_id ?? null,
      is_active: 1,
      created_at: new Date().toISOString(),
    };
    try {
      db.prepare(
        `INSERT INTO schedulers
          (id, name, cron_expression, slack_channel_id, slack_channel_name, memory_theme,
           skill_id, slack_post_enabled, slack_post_channel_id, is_active, created_at)
         VALUES
          (@id, @name, @cron_expression, @slack_channel_id, @slack_channel_name, @memory_theme,
           @skill_id, @slack_post_enabled, @slack_post_channel_id, @is_active, @created_at)`
      ).run(item);
    } catch (err) {
      log.db.error({ err }, 'SchedulerRepo.create failed');
      throw err;
    }
    return item;
  }

  list(): Scheduler[] {
    const db = getDb();
    try {
      const rows = db.prepare('SELECT * FROM schedulers ORDER BY created_at').all() as SchedulerRow[];
      return rows.map(rowToScheduler);
    } catch (err) {
      log.db.error({ err }, 'SchedulerRepo.list failed');
      return [];
    }
  }

  getById(id: string): Scheduler | null {
    const db = getDb();
    try {
      const row = db.prepare('SELECT * FROM schedulers WHERE id = ?').get(id) as SchedulerRow | undefined;
      return row ? rowToScheduler(row) : null;
    } catch (err) {
      log.db.error({ err, id }, 'SchedulerRepo.getById failed');
      return null;
    }
  }

  update(id: string, patch: Partial<Omit<Scheduler, 'id' | 'created_at'>>): Scheduler {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) throw new Error(`Scheduler ${id} not found`);
    const updated = { ...existing, ...patch };
    try {
      db.prepare(
        `UPDATE schedulers SET
          name = @name, cron_expression = @cron_expression,
          slack_channel_id = @slack_channel_id, slack_channel_name = @slack_channel_name,
          memory_theme = @memory_theme, skill_id = @skill_id,
          slack_post_enabled = @slack_post_enabled, slack_post_channel_id = @slack_post_channel_id,
          is_active = @is_active
         WHERE id = @id`
      ).run(updated);
    } catch (err) {
      log.db.error({ err, id }, 'SchedulerRepo.update failed');
      throw err;
    }
    return updated;
  }

  delete(id: string): void {
    const db = getDb();
    try {
      db.prepare('DELETE FROM schedulers WHERE id = ?').run(id);
    } catch (err) {
      log.db.error({ err, id }, 'SchedulerRepo.delete failed');
      throw err;
    }
  }

  setActive(id: string, active: boolean): void {
    const db = getDb();
    try {
      db.prepare('UPDATE schedulers SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
    } catch (err) {
      log.db.error({ err, id }, 'SchedulerRepo.setActive failed');
      throw err;
    }
  }

  getMembers(schedulerId: string): SchedulerMember[] {
    const db = getDb();
    try {
      const rows = db
        .prepare('SELECT * FROM scheduler_members WHERE scheduler_id = ? ORDER BY slack_display_name')
        .all(schedulerId) as MemberRow[];
      return rows.map(rowToMember);
    } catch (err) {
      log.db.error({ err, schedulerId }, 'SchedulerRepo.getMembers failed');
      return [];
    }
  }

  setMembers(
    schedulerId: string,
    members: Array<{ slack_user_id: string; slack_display_name: string }>
  ): void {
    const db = getDb();
    try {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM scheduler_members WHERE scheduler_id = ?').run(schedulerId);
        const insert = db.prepare(
          `INSERT INTO scheduler_members (id, scheduler_id, slack_user_id, slack_display_name, created_at)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const m of members) {
          insert.run(crypto.randomUUID(), schedulerId, m.slack_user_id, m.slack_display_name, new Date().toISOString());
        }
      });
      tx();
    } catch (err) {
      log.db.error({ err, schedulerId }, 'SchedulerRepo.setMembers failed');
      throw err;
    }
  }
}

export const schedulerRepo = new SchedulerRepo();
