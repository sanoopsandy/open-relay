import { create } from 'zustand';
import type { MemoryItem } from '../../shared/types';

interface MemoryStoreState {
  themes: string[];
  activeTheme: string | null;
  items: MemoryItem[];
  loading: boolean;

  setThemes: (themes: string[]) => void;
  setActiveTheme: (theme: string | null) => void;
  setItems: (items: MemoryItem[]) => void;
  setLoading: (loading: boolean) => void;
  addItem: (item: MemoryItem) => void;
  removeItem: (id: string) => void;
  addThemeIfMissing: (theme: string) => void;
}

export const useMemoryStore = create<MemoryStoreState>((set) => ({
  themes: [],
  activeTheme: null,
  items: [],
  loading: false,

  setThemes: (themes) => set({ themes }),
  setActiveTheme: (theme) => set({ activeTheme: theme }),
  setItems: (items) => set({ items }),
  setLoading: (loading) => set({ loading }),

  addItem: (item) =>
    set((s) => ({
      items: s.activeTheme === null || s.activeTheme === item.theme
        ? [item, ...s.items]
        : s.items,
    })),

  removeItem: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  addThemeIfMissing: (theme) =>
    set((s) =>
      s.themes.includes(theme)
        ? {}
        : { themes: [...s.themes, theme].sort() }
    ),
}));
