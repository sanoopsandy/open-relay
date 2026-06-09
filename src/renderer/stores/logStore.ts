import { create } from 'zustand';
import type { LogLine } from '../../shared/types';

const MAX_LINES = 500;

interface LogState {
  lines: LogLine[];
  isStreaming: boolean;
  appendLine: (line: LogLine) => void;
  clearLines: () => void;
  setStreaming: (streaming: boolean) => void;
}

export const useLogStore = create<LogState>((set) => ({
  lines: [],
  isStreaming: false,

  appendLine: (line) =>
    set((state) => {
      const next = [...state.lines, line];
      return { lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next };
    }),

  clearLines: () => set({ lines: [] }),

  setStreaming: (isStreaming) => set({ isStreaming }),
}));
