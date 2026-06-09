import { create } from 'zustand';
import type { Scheduler, SchedulerMember, SchedulerRun, SkillMeta } from '../../shared/types';

interface SchedulerStoreState {
  schedulers: Scheduler[];
  selectedId: string | null;
  runs: Map<string, SchedulerRun[]>;
  skills: SkillMeta[];
  loading: boolean;
  // Actions
  setSchedulers: (schedulers: Scheduler[]) => void;
  upsertScheduler: (scheduler: Scheduler) => void;
  removeScheduler: (id: string) => void;
  setSelectedId: (id: string | null) => void;
  setRuns: (schedulerId: string, runs: SchedulerRun[]) => void;
  prependRun: (run: SchedulerRun) => void;
  updateRun: (run: SchedulerRun) => void;
  setSkills: (skills: SkillMeta[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useSchedulerStore = create<SchedulerStoreState>((set) => ({
  schedulers: [],
  selectedId: null,
  runs: new Map(),
  skills: [],
  loading: false,

  setSchedulers: (schedulers) => set({ schedulers }),

  upsertScheduler: (scheduler) =>
    set((s) => {
      const exists = s.schedulers.findIndex((x) => x.id === scheduler.id);
      const updated =
        exists >= 0
          ? s.schedulers.map((x) => (x.id === scheduler.id ? scheduler : x))
          : [...s.schedulers, scheduler];
      return { schedulers: updated };
    }),

  removeScheduler: (id) =>
    set((s) => ({
      schedulers: s.schedulers.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  setSelectedId: (id) => set({ selectedId: id }),

  setRuns: (schedulerId, runs) =>
    set((s) => {
      const next = new Map(s.runs);
      next.set(schedulerId, runs);
      return { runs: next };
    }),

  prependRun: (run) =>
    set((s) => {
      const next = new Map(s.runs);
      const existing = next.get(run.scheduler_id) ?? [];
      next.set(run.scheduler_id, [run, ...existing]);
      return { runs: next };
    }),

  updateRun: (run) =>
    set((s) => {
      const next = new Map(s.runs);
      const existing = next.get(run.scheduler_id) ?? [];
      next.set(
        run.scheduler_id,
        existing.map((r) => (r.id === run.id ? run : r))
      );
      return { runs: next };
    }),

  setSkills: (skills) => set({ skills }),

  setLoading: (loading) => set({ loading }),
}));

// Helpers for components
export function getRunsForScheduler(state: SchedulerStoreState, schedulerId: string): SchedulerRun[] {
  return state.runs.get(schedulerId) ?? [];
}

export function getMembersForScheduler(_schedulerId: string): SchedulerMember[] {
  // Members fetched on demand via IPC — not stored globally
  return [];
}
