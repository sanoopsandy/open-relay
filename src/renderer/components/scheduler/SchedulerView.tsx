import React, { useEffect, useState } from 'react';
import type { Scheduler, SchedulerMember, SchedulerRun } from '../../../shared/types';
import { useSchedulerStore, getRunsForScheduler } from '../../stores/schedulerStore';
import SchedulerResultCard from './SchedulerResultCard';
import NewSchedulerWizard from './NewSchedulerWizard';

type RightPane = 'detail' | 'wizard' | 'empty';

export default function SchedulerView() {
  const store = useSchedulerStore();
  const [rightPane, setRightPane] = useState<RightPane>('empty');
  const [members, setMembers] = useState<SchedulerMember[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const selectedScheduler = store.schedulers.find((s) => s.id === store.selectedId) ?? null;

  // Load schedulers + skills on mount
  useEffect(() => {
    void (async () => {
      store.setLoading(true);
      try {
        const [schedulers, skills] = await Promise.all([
          window.relay.invoke<Scheduler[]>('scheduler:list'),
          window.relay.invoke<import('../../../shared/types').SkillMeta[]>('skills:list'),
        ]);
        store.setSchedulers(schedulers);
        store.setSkills(skills);
        if (schedulers.length > 0 && !store.selectedId) {
          store.setSelectedId(schedulers[0].id);
          setRightPane('detail');
        }
      } catch (err) {
        console.error('Failed to load schedulers:', err);
      }
      store.setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load runs + members when selectedId changes
  useEffect(() => {
    if (!store.selectedId) return;
    const id = store.selectedId;

    setLoadingRuns(true);
    Promise.all([
      window.relay.invoke<SchedulerRun[]>('scheduler:listRuns', id),
      window.relay.invoke<SchedulerMember[]>('scheduler:getMembers', id),
    ])
      .then(([runs, mems]) => {
        store.setRuns(id, runs);
        setMembers(mems);
      })
      .catch(console.error)
      .finally(() => setLoadingRuns(false));
  }, [store.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for run events
  useEffect(() => {
    const unsub1 = window.relay.on('scheduler:runComplete', async (payload) => {
      const { schedulerId, runId } = payload as { schedulerId: string; runId: string };
      // Re-fetch the updated run
      try {
        const runs = await window.relay.invoke<SchedulerRun[]>('scheduler:listRuns', schedulerId);
        store.setRuns(schedulerId, runs);
        // Also refresh scheduler list to get updated state
        const schedulers = await window.relay.invoke<Scheduler[]>('scheduler:list');
        store.setSchedulers(schedulers);
      } catch {
        console.error('Failed to refresh runs after runComplete', runId);
      }
    });

    const unsub2 = window.relay.on('scheduler:runFailed', async (payload) => {
      const { schedulerId } = payload as { schedulerId: string; error: string };
      try {
        const runs = await window.relay.invoke<SchedulerRun[]>('scheduler:listRuns', schedulerId);
        store.setRuns(schedulerId, runs);
      } catch {
        // ignore
      }
    });

    return () => { unsub1(); unsub2(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelectScheduler(id: string) {
    store.setSelectedId(id);
    setRightPane('detail');
  }

  async function handleToggleActive(scheduler: Scheduler) {
    const newActive = !scheduler.is_active;
    try {
      await window.relay.invoke('scheduler:setActive', scheduler.id, newActive);
      store.upsertScheduler({ ...scheduler, is_active: newActive ? 1 : 0 });
    } catch (err) {
      console.error('Failed to toggle scheduler:', err);
    }
  }

  async function handleDelete(scheduler: Scheduler) {
    if (!confirm(`Delete scheduler "${scheduler.name}"?`)) return;
    try {
      await window.relay.invoke('scheduler:delete', scheduler.id);
      store.removeScheduler(scheduler.id);
      if (store.selectedId === scheduler.id) {
        setRightPane('empty');
      }
    } catch (err) {
      console.error('Failed to delete scheduler:', err);
    }
  }

  async function handleManualRun(schedulerId: string) {
    try {
      await window.relay.invoke('scheduler:triggerManual', schedulerId);
    } catch (err) {
      console.error('Failed to trigger manual run:', err);
    }
  }

  function handleWizardSaved(scheduler: Scheduler) {
    store.upsertScheduler(scheduler);
    store.setSelectedId(scheduler.id);
    setRightPane('detail');
  }

  const skillName = selectedScheduler
    ? (store.skills.find((s) => s.id === selectedScheduler.skill_id)?.name ?? selectedScheduler.skill_id)
    : '';

  const runs = store.selectedId ? getRunsForScheduler(store, store.selectedId) : [];

  return (
    <div className="h-full flex bg-[--bg-base] overflow-hidden">
      {/* Left column — scheduler list */}
      <div className="flex-none w-56 border-r border-[--border] flex flex-col bg-[--bg-sidebar]">
        {/* Header */}
        <div className="px-3 pt-10 pb-3">
          <span className="text-[10px] font-semibold text-[--text-muted] uppercase tracking-wider">Schedulers</span>
        </div>

        {/* New button */}
        <div className="px-2 pb-2">
          <button
            onClick={() => { store.setSelectedId(null); setRightPane('wizard'); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[11px] bg-[--accent] text-white hover:bg-[--accent-hover] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Scheduler
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {store.loading && (
            <p className="text-[10px] text-[--text-muted] px-2 py-4 text-center">Loading…</p>
          )}
          {!store.loading && store.schedulers.length === 0 && (
            <p className="text-[10px] text-[--text-muted] px-2 py-4 text-center">No schedulers yet</p>
          )}
          {store.schedulers.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelectScheduler(s.id)}
              className={[
                'w-full text-left px-3 py-2 rounded-md flex items-center gap-2 transition-colors',
                store.selectedId === s.id && rightPane === 'detail'
                  ? 'bg-[--bg-active] text-[--text-primary]'
                  : 'text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]',
              ].join(' ')}
            >
              <span className={`w-2 h-2 rounded-full flex-none ${s.is_active ? 'bg-green-500' : 'bg-[--text-muted]'}`} />
              <span className="flex-1 truncate text-[11px] font-medium">{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {rightPane === 'wizard' && (
          <NewSchedulerWizard
            onSaved={handleWizardSaved}
            onCancel={() => setRightPane(store.selectedId ? 'detail' : 'empty')}
          />
        )}

        {rightPane === 'empty' && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[11px] text-[--text-muted]">Select a scheduler or create one</p>
          </div>
        )}

        {rightPane === 'detail' && selectedScheduler && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Detail header */}
            <div className="flex-none px-5 pt-6 pb-3 border-b border-[--border]">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-[--text-primary] truncate">{selectedScheduler.name}</h2>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-[10px] text-[--text-muted]">
                    <span>
                      Channel: <span className="text-[--text-secondary]">
                        {selectedScheduler.slack_channel_name ? `#${selectedScheduler.slack_channel_name}` : selectedScheduler.slack_channel_id}
                      </span>
                    </span>
                    <span>
                      Cron: <code className="font-mono text-[--text-secondary]">{selectedScheduler.cron_expression}</code>
                    </span>
                    <span>
                      Skill: <span className="text-[--text-secondary]">{skillName}</span>
                    </span>
                    <span>
                      Memory: <span className="text-[--text-secondary]">{selectedScheduler.memory_theme}</span>
                    </span>
                  </div>
                  {members.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {members.map((m) => (
                        <span key={m.id} className="text-[10px] px-1.5 py-0.5 bg-[--bg-hover] rounded text-[--text-secondary]">
                          {m.slack_display_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-none">
                  {/* Active toggle */}
                  <button
                    onClick={() => handleToggleActive(selectedScheduler)}
                    title={selectedScheduler.is_active ? 'Disable' : 'Enable'}
                    className={[
                      'text-[10px] px-2 py-1 rounded border transition-colors',
                      selectedScheduler.is_active
                        ? 'border-green-500/40 text-green-400 hover:bg-red-400/10 hover:border-red-400/40 hover:text-red-400'
                        : 'border-[--border] text-[--text-muted] hover:border-green-500/40 hover:text-green-400',
                    ].join(' ')}
                  >
                    {selectedScheduler.is_active ? 'Active' : 'Paused'}
                  </button>
                  {/* Manual run */}
                  <button
                    onClick={() => handleManualRun(selectedScheduler.id)}
                    title="Trigger now"
                    className="text-[10px] px-2 py-1 rounded border border-[--border] text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
                  >
                    ▶ Run
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(selectedScheduler)}
                    title="Delete scheduler"
                    className="text-[10px] px-2 py-1 rounded border border-[--border] text-[--text-muted] hover:text-red-400 hover:border-red-400/40 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>

            {/* Run history */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-semibold text-[--text-muted] uppercase tracking-wider">Run History</span>
                {loadingRuns && <span className="text-[10px] text-[--text-muted]">Loading…</span>}
              </div>

              {!loadingRuns && runs.length === 0 && (
                <p className="text-[11px] text-[--text-muted]">No runs yet. Trigger a run to see results.</p>
              )}

              <div className="space-y-2">
                {runs.map((run) => (
                  <SchedulerResultCard key={run.id} run={run} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
