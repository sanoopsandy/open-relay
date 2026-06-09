import type { Skill, SkillContext, SkillResult } from './SkillBase';
import type { SprintAnalysisOutput } from '../ipc/types';
import { log } from '../logger';

const SYSTEM_PROMPT = `You are a sprint status analyser. Given Slack messages and a sprint plan, produce a structured JSON status report for each team member.

Flag rules:
- "green"   : member posted an update, task progressing normally
- "yellow"  : member was silent in the pull window — no update found
- "red"     : member explicitly mentioned a blocker, dependency, or is stuck
- "warning" : task not started or unassigned and sprint end is within 3 days

Respond ONLY with a single valid JSON object matching this exact schema:
{
  "run_date": "YYYY-MM-DD",
  "sprint_end": "YYYY-MM-DD or unknown",
  "days_remaining": <number or -1 if unknown>,
  "members": [
    {
      "name": "<display name>",
      "slack_handle": "<@slack_user_id>",
      "flag": "green|yellow|red|warning",
      "reason": "<one sentence reason for the flag>",
      "tasks": ["<task description>"],
      "summary": "<2–3 sentence member summary>"
    }
  ]
}

Do not include any text outside the JSON object.`;

export class SprintAnalysisSkill implements Skill {
  readonly id = 'sprint-analysis';
  readonly name = 'Sprint Status Analysis';
  readonly description = 'Analyses Slack messages against a sprint plan and flags member status.';

  async run(ctx: SkillContext): Promise<SkillResult> {
    const { scheduler, members, run, slackMessages, sprintContent, provider, config } = ctx;

    const today = run.triggered_at.slice(0, 10);
    const pullFrom = run.last_pull_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pullUntil = run.triggered_at;

    const memberList = members.map((m) => ({
      slack_user_id: m.slack_user_id,
      slack_display_name: m.slack_display_name,
    }));

    const userPrompt = `<sprint_plan>
${sprintContent || 'No sprint plan available.'}
</sprint_plan>

<team_members>
${JSON.stringify(memberList, null, 2)}
</team_members>

<slack_messages channel="${scheduler.slack_channel_id}" from="${pullFrom}" to="${pullUntil}">
${JSON.stringify(slackMessages, null, 2)}
</slack_messages>

Today's date: ${today}

Produce the status JSON for each team member.`;

    log.skill.info(
      { schedulerId: scheduler.id, memberCount: members.length, messageCount: slackMessages.length },
      'SprintAnalysisSkill running'
    );

    const response = await provider.chat(
      [
        { role: 'user', content: userPrompt },
      ],
      {
        model: config.ai.model,
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 4096,
        temperature: 0,
      }
    );

    let parsed: SprintAnalysisOutput;
    try {
      // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
      const raw = response.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(raw) as SprintAnalysisOutput;
    } catch {
      throw new Error(`SprintAnalysisSkill: LLM returned non-JSON output: ${response.content.slice(0, 200)}`);
    }

    if (!parsed.members || !Array.isArray(parsed.members)) {
      throw new Error('SprintAnalysisSkill: output missing members array');
    }

    const flagCounts = parsed.members.reduce<Record<string, number>>((acc, m) => {
      acc[m.flag] = (acc[m.flag] ?? 0) + 1;
      return acc;
    }, {});

    const summary = [
      flagCounts.red ? `${flagCounts.red} blocker(s)` : '',
      flagCounts.warning ? `${flagCounts.warning} at-risk` : '',
      flagCounts.yellow ? `${flagCounts.yellow} silent` : '',
      flagCounts.green ? `${flagCounts.green} on track` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'All members analysed';

    return { outputJson: parsed as unknown as Record<string, unknown>, summary };
  }
}
