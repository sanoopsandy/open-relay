import type { Scheduler, SchedulerMember, SchedulerRun, HarnessConfig } from '../ipc/types';
import type { AIProvider } from '../ai/AIProvider';

export interface RawSlackMessage {
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
}

export interface SkillContext {
  scheduler: Scheduler;
  members: SchedulerMember[];
  run: SchedulerRun;
  slackMessages: RawSlackMessage[];
  sprintContent: string;
  provider: AIProvider;
  config: HarnessConfig;
}

export interface SkillResult {
  outputJson: Record<string, unknown>;
  summary: string;
}

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  run(ctx: SkillContext): Promise<SkillResult>;
}
