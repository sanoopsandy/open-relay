import { create } from 'zustand';
import type { SlashCommand } from '../../shared/types';

interface CommandStoreState {
  isOpen: boolean;
  query: string;
  results: SlashCommand[];
  selectedIndex: number;
  triggerPosition: { top: number; left: number } | null;

  // Actions
  open: (query?: string, position?: { top: number; left: number }) => void;
  close: () => void;
  setQuery: (query: string) => void;
  setResults: (results: SlashCommand[]) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setSelectedIndex: (index: number) => void;
  getSelected: () => SlashCommand | null;
}

export const useCommandStore = create<CommandStoreState>((set, get) => ({
  isOpen: false,
  query: '',
  results: [],
  selectedIndex: 0,
  triggerPosition: null,

  open: (query = '', position?: { top: number; left: number }) =>
    set({ isOpen: true, query, selectedIndex: 0, triggerPosition: position ?? null }),

  close: () =>
    set({ isOpen: false, query: '', results: [], selectedIndex: 0, triggerPosition: null }),

  setQuery: (query) => set({ query, selectedIndex: 0 }),

  setResults: (results) => set({ results, selectedIndex: 0 }),

  selectNext: () =>
    set((s) => ({
      selectedIndex: s.results.length > 0 ? (s.selectedIndex + 1) % s.results.length : 0,
    })),

  selectPrev: () =>
    set((s) => ({
      selectedIndex:
        s.results.length > 0
          ? (s.selectedIndex - 1 + s.results.length) % s.results.length
          : 0,
    })),

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  getSelected: () => {
    const { results, selectedIndex } = get();
    return results[selectedIndex] ?? null;
  },
}));
