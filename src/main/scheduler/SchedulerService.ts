import cron from 'node-cron';
import type { BrowserWindow } from 'electron';
import { configManager } from '../config/ConfigManager';
import { providerFactory } from '../ai/ProviderFactory';
import { schedulerRepo } from '../db/repositories/SchedulerRepo';
import { schedulerRunRepo } from '../db/repositories/SchedulerRunRepo';
import { memoryRepo } from '../db/repositories/MemoryRepo';
import { skillRegistry } from '../skills/SkillRegistry';
import { SlackReader } from './SlackReader';
import { log } from '../logger';
import type { Scheduler } from '../ipc/types';

class SchedulerService {
  private tasks = new Map<string, cron.ScheduledTask>();
  private mainWindow: BrowserWindow | null = null;

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    const schedulers = schedulerRepo.list().filter((s) => s.is_active);
    log.main.info({ count: schedulers.length }, 'SchedulerService initializing');

    // Check for missed runs (last completed run not today)
    const today = new Date().toDateString();
    for (const s of schedulers) {
      const lastRun = schedulerRunRepo.getLastCompleted(s.id);
      const lastDate = lastRun ? new Date(lastRun.triggered_at).toDateString() : null;
      if (lastDate !== today) {
        log.main.info({ schedulerId: s.id, name: s.name }, 'Firing missed scheduler run on startup');
        void this.runScheduler(s.id);
      }
    }

    // Register cron jobs
    for (const s of schedulers) {
      this.scheduleOne(s);
    }
  }

  scheduleOne(scheduler: Scheduler): void {
    if (this.tasks.has(scheduler.id)) {
      this.tasks.get(scheduler.id)!.stop();
    }
    if (!scheduler.is_active) return;

    try {
      const task = cron.schedule(scheduler.cron_expression, () => {
        void this.runScheduler(scheduler.id);
      });
      this.tasks.set(scheduler.id, task);
      log.main.info({ schedulerId: scheduler.id, cron: scheduler.cron_expression }, 'Scheduler registered');
    } catch (err) {
      log.main.error({ err, schedulerId: scheduler.id }, 'Failed to register cron job');
    }
  }

  stopOne(schedulerId: string): void {
    const task = this.tasks.get(schedulerId);
    if (task) {
      task.stop();
      this.tasks.delete(schedulerId);
    }
  }

  async triggerManual(schedulerId: string): Promise<void> {
    await this.runScheduler(schedulerId);
  }

  async runScheduler(schedulerId: string): Promise<void> {
    const scheduler = schedulerRepo.getById(schedulerId);
    if (!scheduler) {
      log.main.warn({ schedulerId }, 'runScheduler: scheduler not found');
      return;
    }

    const members = schedulerRepo.getMembers(schedulerId);
    const lastCompleted = schedulerRunRepo.getLastCompleted(schedulerId);
    const triggeredAt = new Date().toISOString();
    const lastPullAt = lastCompleted?.pull_until ?? null;

    const run = schedulerRunRepo.create({
      scheduler_id: schedulerId,
      skill_id: scheduler.skill_id,
      triggered_at: triggeredAt,
      last_pull_at: lastPullAt,
    });

    schedulerRunRepo.updateStatus(run.id, 'running');
    log.main.info({ schedulerId, runId: run.id }, 'Scheduler run started');

    try {
      const config = await configManager.load();
      if (!config) throw new Error('No config available');

      const slackConfig = config.integrations.slack;
      if (!slackConfig?.botTokenCiphertext) {
        throw new Error('Slack bot token not configured — set it in onboarding or settings');
      }

      const botToken = configManager.decryptKey(slackConfig.botTokenCiphertext);
      const reader = new SlackReader(botToken);

      // Fetch messages from last pull window
      const oldest = lastPullAt
        ? (parseFloat(new Date(lastPullAt).getTime().toString()) / 1000).toFixed(6)
        : (Date.now() / 1000 - 86400).toFixed(6); // Default: last 24h on first run
      const latest = (Date.now() / 1000).toFixed(6);

      log.main.info({ schedulerId, channelId: scheduler.slack_channel_id, oldest, latest }, 'Fetching Slack messages');
      const slackMessages = await reader.fetchMessages(scheduler.slack_channel_id, oldest, latest);

      // Fetch sprint memory
      const memoryItems = memoryRepo.getByTheme(scheduler.memory_theme);
      const sprintContent = memoryItems.map((item) => item.content).join('\n\n');

      // Run the skill
      const provider = providerFactory.getProvider(config);
      const skill = skillRegistry.get(scheduler.skill_id);

      const runForSkill = schedulerRunRepo.getById(run.id)!;
      runForSkill.last_pull_at = lastPullAt;
      runForSkill.triggered_at = triggeredAt;

      const result = await skill.run({
        scheduler,
        members,
        run: runForSkill,
        slackMessages,
        sprintContent,
        provider,
        config,
      });

      schedulerRunRepo.updateStatus(run.id, 'complete', {
        output_json: JSON.stringify(result.outputJson),
        output_summary: result.summary,
        pull_until: new Date().toISOString(),
      });

      log.main.info({ schedulerId, runId: run.id, summary: result.summary }, 'Scheduler run complete');

      // Optionally post to Slack
      if (scheduler.slack_post_enabled) {
        void this.postToSlack(botToken, scheduler, result.summary, result.outputJson);
      }

      this.emit('scheduler:runComplete', { schedulerId, runId: run.id });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      schedulerRunRepo.updateStatus(run.id, 'failed', { error: errorMsg });
      log.main.error({ err, schedulerId, runId: run.id }, 'Scheduler run failed');
      this.emit('scheduler:runFailed', { schedulerId, runId: run.id, error: errorMsg });
    }
  }

  private async postToSlack(
    token: string,
    scheduler: Scheduler,
    summary: string,
    outputJson: Record<string, unknown>
  ): Promise<void> {
    try {
      const { WebClient } = await import('@slack/web-api');
      const client = new WebClient(token);
      const channelId = scheduler.slack_post_channel_id ?? scheduler.slack_channel_id;

      const output = outputJson as { members?: Array<{ name: string; flag: string; summary: string }> };
      const lines = (output.members ?? []).map(
        (m) => `• ${m.name} — ${m.flag === 'green' ? '🟢' : m.flag === 'red' ? '🔴' : m.flag === 'warning' ? '⚠️' : '🟡'} ${m.summary}`
      );

      const text = `*Sprint Status Update* — ${summary}\n\n${lines.join('\n')}`;
      await client.chat.postMessage({ channel: channelId, text });
      log.main.info({ channelId }, 'Slack post sent');
    } catch (err) {
      log.main.warn({ err }, 'Failed to post to Slack — non-fatal');
    }
  }

  private emit(channel: 'scheduler:runComplete' | 'scheduler:runFailed', payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }
}

export const schedulerService = new SchedulerService();
