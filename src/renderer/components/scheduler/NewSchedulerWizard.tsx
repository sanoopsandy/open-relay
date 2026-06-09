import React, { useEffect, useState } from 'react';
import type { SlackChannel, SlackUser, SkillMeta, Scheduler, CreateSchedulerDto } from '../../../shared/types';

type WizardStep = 'name' | 'channel' | 'members' | 'skill' | 'memory' | 'schedule' | 'saving';

interface WizardState {
  name: string;
  channel: SlackChannel | null;
  selectedMembers: SlackUser[];
  skillId: string;
  memoryTheme: string;
  cronExpression: string;
  cronHour: string;
  cronMinute: string;
  slackPostEnabled: boolean;
}

interface Props {
  onSaved: (scheduler: Scheduler) => void;
  onCancel: () => void;
}

export default function NewSchedulerWizard({ onSaved, onCancel }: Props) {
  const [step, setStep] = useState<WizardStep>('name');
  const [state, setState] = useState<WizardState>({
    name: '',
    channel: null,
    selectedMembers: [],
    skillId: 'sprint-analysis',
    memoryTheme: '',
    cronExpression: '0 12 * * *',
    cronHour: '12',
    cronMinute: '00',
    slackPostEnabled: false,
  });

  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [members, setMembers] = useState<SlackUser[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualChannelId, setManualChannelId] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');

  // Load channels on step transition
  useEffect(() => {
    if (step === 'channel' && channels.length === 0) {
      setLoading(true);
      window.relay
        .invoke<SlackChannel[]>('scheduler:getSlackChannels')
        .then(setChannels)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [step, channels.length]);

  // Load channel members when entering members step — always re-fetch for the selected channel
  useEffect(() => {
    if (step === 'members' && state.channel) {
      setMembers([]);
      setMemberSearch('');
      setLoading(true);
      window.relay
        .invoke<SlackUser[]>('scheduler:getSlackMembers', state.channel.id)
        .then(setMembers)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step === 'skill' && skills.length === 0) {
      window.relay.invoke<SkillMeta[]>('skills:list').then(setSkills).catch(console.error);
    }
  }, [step, skills.length]);

  useEffect(() => {
    if (step === 'memory' && themes.length === 0) {
      window.relay.invoke<string[]>('memory:listThemes').then(setThemes).catch(console.error);
    }
  }, [step, themes.length]);

  function update(patch: Partial<WizardState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  function buildCron(hour: string, minute: string): string {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return '0 12 * * *';
    return `${m} ${h} * * *`;
  }

  async function handleSave() {
    setStep('saving');
    try {
      const dto: CreateSchedulerDto = {
        name: state.name,
        cron_expression: state.cronExpression,
        slack_channel_id: state.channel!.id,
        slack_channel_name: state.channel!.name,
        memory_theme: state.memoryTheme,
        skill_id: state.skillId,
        slack_post_enabled: state.slackPostEnabled ? 1 : 0,
      };
      const scheduler = await window.relay.invoke<Scheduler>('scheduler:create', dto);
      // Set members
      if (state.selectedMembers.length > 0) {
        await window.relay.invoke('scheduler:setMembers', scheduler.id, state.selectedMembers.map((m) => ({
          slack_user_id: m.id,
          slack_display_name: m.displayName,
        })));
      }
      onSaved(scheduler);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('schedule');
    }
  }

  function toggleMember(user: SlackUser) {
    setState((s) => {
      const exists = s.selectedMembers.find((m) => m.id === user.id);
      return {
        ...s,
        selectedMembers: exists
          ? s.selectedMembers.filter((m) => m.id !== user.id)
          : [...s.selectedMembers, user],
      };
    });
  }

  const STEPS: WizardStep[] = ['name', 'channel', 'members', 'skill', 'memory', 'schedule'];
  const stepIndex = STEPS.indexOf(step);

  const stepLabels: Record<WizardStep, string> = {
    name: '1 Name',
    channel: '2 Channel',
    members: '3 Members',
    skill: '4 Skill',
    memory: '5 Memory',
    schedule: '6 Schedule',
    saving: 'Saving…',
  };

  return (
    <div className="h-full flex flex-col bg-[--bg-base]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[--border] bg-[--bg-sidebar] flex-none">
        <span className="text-[11px] font-semibold text-[--text-primary] uppercase tracking-wider">New Scheduler</span>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="text-[--text-muted] hover:text-[--text-primary] text-xs px-2 py-1 rounded hover:bg-[--bg-hover] transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Step tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0 flex-none flex-wrap">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={[
              'text-[10px] px-2 py-0.5 rounded',
              i < stepIndex
                ? 'text-green-400 bg-green-400/10'
                : s === step
                ? 'text-[--text-primary] bg-[--bg-active]'
                : 'text-[--text-muted]',
            ].join(' ')}
          >
            {stepLabels[s]}
          </span>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error && (
          <div className="mb-3 text-[11px] text-red-400 bg-red-400/10 rounded px-3 py-2">{error}</div>
        )}

        {/* Step: name */}
        {step === 'name' && (
          <div className="space-y-3">
            <label className="block text-[11px] text-[--text-secondary]">Scheduler name</label>
            <input
              autoFocus
              type="text"
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && state.name.trim() && setStep('channel')}
              placeholder="e.g. Sprint Daily Check"
              className="w-full bg-[--bg-sidebar] border border-[--border] rounded px-3 py-2 text-[11px] text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
            />
            <button
              disabled={!state.name.trim()}
              onClick={() => setStep('channel')}
              className="px-4 py-1.5 rounded text-[11px] bg-[--accent] text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}

        {/* Step: channel */}
        {step === 'channel' && (
          <div className="space-y-3">
            <label className="block text-[11px] text-[--text-secondary]">Select Slack channel to monitor</label>

            {/* Manual channel ID input */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Paste channel ID (e.g. C0123ABC456)"
                value={manualChannelId}
                onChange={(e) => setManualChannelId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualChannelId.trim()) {
                    const id = manualChannelId.trim();
                    update({ channel: { id, name: id } });
                    setStep('members');
                  }
                }}
                className="flex-1 bg-[--bg-sidebar] border border-[--border] rounded px-3 py-1.5 text-[11px] text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
              />
              <button
                disabled={!manualChannelId.trim()}
                onClick={() => {
                  const id = manualChannelId.trim();
                  update({ channel: { id, name: id } });
                  setStep('members');
                }}
                className="px-3 py-1.5 rounded text-[11px] bg-[--accent] text-white disabled:opacity-40"
              >
                Use
              </button>
            </div>

            <p className="text-[10px] text-[--text-muted]">— or pick from list —</p>

            {loading && <p className="text-[11px] text-[--text-muted]">Loading channels…</p>}
            {!loading && channels.length > 0 && (
              <input
                type="text"
                placeholder="Search channels…"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                className="w-full bg-[--bg-sidebar] border border-[--border] rounded px-3 py-1.5 text-[11px] text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
              />
            )}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {channels
                .filter((c) => !channelSearch || c.name.toLowerCase().includes(channelSearch.toLowerCase()) || c.id.toLowerCase().includes(channelSearch.toLowerCase()))
                .map((c) => (
                <button
                  key={c.id}
                  onClick={() => { update({ channel: c }); setStep('members'); }}
                  className={[
                    'w-full text-left px-3 py-2 rounded text-[11px] transition-colors',
                    state.channel?.id === c.id
                      ? 'bg-[--bg-active] text-[--text-primary]'
                      : 'text-[--text-secondary] hover:bg-[--bg-hover]',
                  ].join(' ')}
                >
                  # {c.name}
                  <span className="text-[10px] text-[--text-muted] ml-2 font-mono">{c.id}</span>
                </button>
              ))}
            </div>
            {channels.length === 0 && !loading && (
              <p className="text-[11px] text-[--text-muted]">No channels found — paste the channel ID above.</p>
            )}
          </div>
        )}

        {/* Step: members */}
        {step === 'members' && (
          <div className="space-y-3">
            <label className="block text-[11px] text-[--text-secondary]">
              Members in #{state.channel?.name ?? state.channel?.id} ({state.selectedMembers.length} selected)
            </label>
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-[--text-muted]">
                <span className="w-3 h-3 rounded-full border-2 border-[--accent] border-t-transparent animate-spin" />
                Fetching channel members…
              </div>
            )}
            {!loading && members.length > 0 && (
              <input
                type="text"
                placeholder="Search members…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                autoFocus
                className="w-full bg-[--bg-sidebar] border border-[--border] rounded px-3 py-1.5 text-[11px] text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
              />
            )}
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {members
                .filter((u) => {
                  if (!memberSearch) return true;
                  const q = memberSearch.toLowerCase();
                  return (
                    u.displayName.toLowerCase().includes(q) ||
                    u.realName.toLowerCase().includes(q)
                  );
                })
                .map((u) => {
                const selected = !!state.selectedMembers.find((m) => m.id === u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleMember(u)}
                    className={[
                      'w-full text-left px-3 py-2 rounded text-[11px] flex items-center gap-2 transition-colors',
                      selected ? 'bg-[--bg-active] text-[--text-primary]' : 'text-[--text-secondary] hover:bg-[--bg-hover]',
                    ].join(' ')}
                  >
                    <span className="w-3.5 flex-none text-center text-green-400">{selected ? '✓' : ''}</span>
                    <span>{u.displayName || u.realName}</span>
                    {u.realName && u.displayName && u.realName !== u.displayName && (
                      <span className="text-[10px] text-[--text-muted]">({u.realName})</span>
                    )}
                  </button>
                );
              })}
            </div>
            {!loading && members.length === 0 && (
              <p className="text-[11px] text-[--text-muted]">No members found in this channel.</p>
            )}
            <button
              disabled={state.selectedMembers.length === 0}
              onClick={() => setStep('skill')}
              className="px-4 py-1.5 rounded text-[11px] bg-[--accent] text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}

        {/* Step: skill */}
        {step === 'skill' && (
          <div className="space-y-3">
            <label className="block text-[11px] text-[--text-secondary]">Select analysis skill</label>
            <div className="space-y-2">
              {skills.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { update({ skillId: s.id }); setStep('memory'); }}
                  className={[
                    'w-full text-left px-3 py-2 rounded border transition-colors',
                    state.skillId === s.id
                      ? 'border-[--accent] bg-[--bg-active]'
                      : 'border-[--border] hover:bg-[--bg-hover]',
                  ].join(' ')}
                >
                  <div className="text-[11px] text-[--text-primary] font-medium">{s.name}</div>
                  <div className="text-[10px] text-[--text-muted] mt-0.5">{s.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: memory */}
        {step === 'memory' && (
          <div className="space-y-3">
            <label className="block text-[11px] text-[--text-secondary]">Select memory theme (sprint plan)</label>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {themes.map((t) => (
                <button
                  key={t}
                  onClick={() => { update({ memoryTheme: t }); setStep('schedule'); }}
                  className={[
                    'w-full text-left px-3 py-2 rounded text-[11px] transition-colors',
                    state.memoryTheme === t
                      ? 'bg-[--bg-active] text-[--text-primary]'
                      : 'text-[--text-secondary] hover:bg-[--bg-hover]',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>
            {themes.length === 0 && (
              <p className="text-[11px] text-[--text-muted]">No memory themes found. Add a sprint plan to memory first.</p>
            )}
            <button
              disabled={!state.memoryTheme}
              onClick={() => setStep('schedule')}
              className="px-4 py-1.5 rounded text-[11px] bg-[--accent] text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}

        {/* Step: schedule */}
        {step === 'schedule' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] text-[--text-secondary] mb-2">Run daily at (24h)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={state.cronHour}
                  onChange={(e) => {
                    const h = e.target.value;
                    update({ cronHour: h, cronExpression: buildCron(h, state.cronMinute) });
                  }}
                  className="w-16 bg-[--bg-sidebar] border border-[--border] rounded px-2 py-1.5 text-[11px] text-center text-[--text-primary] outline-none focus:border-[--accent]"
                />
                <span className="text-[--text-muted]">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={state.cronMinute}
                  onChange={(e) => {
                    const m = e.target.value;
                    update({ cronMinute: m, cronExpression: buildCron(state.cronHour, m) });
                  }}
                  className="w-16 bg-[--bg-sidebar] border border-[--border] rounded px-2 py-1.5 text-[11px] text-center text-[--text-primary] outline-none focus:border-[--accent]"
                />
              </div>
              <p className="text-[10px] text-[--text-muted] mt-1">Cron: <code className="font-mono">{state.cronExpression}</code></p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.slackPostEnabled}
                onChange={(e) => update({ slackPostEnabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-[11px] text-[--text-secondary]">Post summary to Slack after each run</span>
            </label>

            <p className="text-[10px] text-[--text-muted]">
              ⚠ Scheduler only runs while Relay is open.
            </p>

            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded text-[11px] bg-[--accent] text-white"
            >
              Save Scheduler
            </button>
          </div>
        )}

        {step === 'saving' && (
          <div className="flex items-center gap-2 text-[11px] text-[--text-muted]">
            <span className="w-4 h-4 rounded-full border-2 border-[--accent] border-t-transparent animate-spin" />
            Saving…
          </div>
        )}
      </div>
    </div>
  );
}
