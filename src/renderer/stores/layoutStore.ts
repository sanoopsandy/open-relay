import { create } from 'zustand';
import type { LayoutState } from '../../shared/types';

interface LayoutStoreState extends LayoutState {
  // Transient (not persisted)
  artifactPaneOpen: boolean;
  activeView: 'chat' | 'scheduler' | 'settings';
  // Actions
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setMemoryPaneOpen: (open: boolean) => void;
  toggleMemoryPane: () => void;
  openArtifactPane: () => void;
  closeArtifactPane: () => void;
  setLogViewerOpen: (open: boolean) => void;
  toggleLogViewer: () => void;
  setChatPanel: (state: LayoutState['chatPanel']) => void;
  applyPatch: (patch: Partial<LayoutState>, options?: { persist?: boolean }) => void;
  persistLayout: () => void;
  setActiveView: (view: 'chat' | 'scheduler' | 'settings') => void;
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncePersist(state: LayoutState) {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    window.relay
      .invoke('layout:set', {
        chatPanel: state.chatPanel,
        memoryPaneOpen: state.memoryPaneOpen,
        sidebarOpen: state.sidebarOpen,
        logViewerOpen: state.logViewerOpen,
      })
      .catch(console.error);
  }, 300);
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  chatPanel: 'visible',
  memoryPaneOpen: false,
  sidebarOpen: true,
  logViewerOpen: false,
  artifactPaneOpen: false,
  activeView: 'chat',

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
    debouncePersist(get());
  },

  toggleSidebar: () => {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
    debouncePersist(get());
  },

  setMemoryPaneOpen: (open) => {
    set({ memoryPaneOpen: open, ...(open ? { artifactPaneOpen: false } : {}) });
    debouncePersist(get());
  },

  toggleMemoryPane: () => {
    set((s) => ({
      memoryPaneOpen: !s.memoryPaneOpen,
      artifactPaneOpen: s.memoryPaneOpen ? s.artifactPaneOpen : false,
    }));
    debouncePersist(get());
  },

  openArtifactPane: () => {
    set({ artifactPaneOpen: true, memoryPaneOpen: false });
  },

  closeArtifactPane: () => {
    set({ artifactPaneOpen: false });
  },

  setLogViewerOpen: (open) => {
    set({ logViewerOpen: open });
    debouncePersist(get());
  },

  toggleLogViewer: () => {
    set((s) => ({ logViewerOpen: !s.logViewerOpen }));
    debouncePersist(get());
  },

  setChatPanel: (state) => {
    set({ chatPanel: state });
    debouncePersist(get());
  },

  applyPatch: (patch, options) => {
    set(patch);
    if (options?.persist !== false) {
      debouncePersist(get());
    }
  },

  persistLayout: () => {
    debouncePersist(get());
  },

  setActiveView: (view) => {
    set({ activeView: view });
  },
}));
