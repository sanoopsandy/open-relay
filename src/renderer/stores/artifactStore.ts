import { create } from 'zustand';
import type { Artifact, PersistedArtifact } from '../../shared/types';

interface ArtifactStoreState {
  byConversation: Record<string, Artifact[]>;
  currentConversationId: string | null;
  artifacts: Artifact[]; // mirrors byConversation[currentConversationId]

  // Permanent registry — artifacts are never deleted from here, only from tabs
  artifactRegistry: Record<string, Artifact>;

  // Per-message artifact association (UUID keys → no collision across conversations)
  streamArtifactIds: string[];
  messageArtifacts: Record<string, string[]>; // messageId → artifactIds

  // Request a specific artifact to be focused when the pane opens
  focusArtifactId: string | null;

  switchConversation: (id: string) => void;
  add: (artifact: Artifact) => void;
  remove: (id: string) => void;
  clear: () => void;

  trackStreamArtifact: (id: string) => void;
  associateArtifactsWithMessage: (messageId: string) => void;
  setFocusArtifactId: (id: string | null) => void;
  loadPersisted: (persisted: PersistedArtifact[]) => void;
}

export const useArtifactStore = create<ArtifactStoreState>((set) => ({
  byConversation: {},
  currentConversationId: null,
  artifacts: [],

  artifactRegistry: {},

  streamArtifactIds: [],
  messageArtifacts: {},
  focusArtifactId: null,

  switchConversation: (id) =>
    set((s) => ({
      currentConversationId: id,
      artifacts: s.byConversation[id] ?? [],
    })),

  add: (artifact) =>
    set((s) => {
      const convId = s.currentConversationId ?? '';
      const existing = s.byConversation[convId] ?? [];
      const updated = existing.some((a) => a.id === artifact.id)
        ? existing.map((a) => (a.id === artifact.id ? artifact : a))
        : [...existing, artifact];
      return {
        byConversation: { ...s.byConversation, [convId]: updated },
        artifacts: updated,
        // Registry is permanent — only add/update, never remove
        artifactRegistry: artifact.content
          ? { ...s.artifactRegistry, [artifact.id]: artifact }
          : s.artifactRegistry,
      };
    }),

  remove: (id) =>
    set((s) => {
      const convId = s.currentConversationId ?? '';
      const updated = (s.byConversation[convId] ?? []).filter((a) => a.id !== id);
      return {
        byConversation: { ...s.byConversation, [convId]: updated },
        artifacts: updated,
      };
    }),

  clear: () =>
    set((s) => {
      const convId = s.currentConversationId ?? '';
      return {
        byConversation: { ...s.byConversation, [convId]: [] },
        artifacts: [],
      };
    }),

  trackStreamArtifact: (id) =>
    set((s) => ({ streamArtifactIds: [...s.streamArtifactIds, id] })),

  associateArtifactsWithMessage: (messageId) =>
    set((s) => ({
      messageArtifacts: s.streamArtifactIds.length > 0
        ? { ...s.messageArtifacts, [messageId]: s.streamArtifactIds }
        : s.messageArtifacts,
      streamArtifactIds: [],
    })),

  setFocusArtifactId: (id) => set({ focusArtifactId: id }),

  loadPersisted: (persisted) =>
    set((s) => {
      const convId = s.currentConversationId ?? '';
      const artifacts: Artifact[] = persisted.map(({ id, name, language, content }) => ({ id, name, language, content }));
      const registry: Record<string, Artifact> = { ...s.artifactRegistry };
      const msgArtifacts: Record<string, string[]> = { ...s.messageArtifacts };

      for (const p of persisted) {
        registry[p.id] = { id: p.id, name: p.name, language: p.language, content: p.content };
        if (!msgArtifacts[p.messageId]) msgArtifacts[p.messageId] = [];
        if (!msgArtifacts[p.messageId].includes(p.id)) msgArtifacts[p.messageId].push(p.id);
      }

      return {
        byConversation: { ...s.byConversation, [convId]: artifacts },
        artifacts,
        artifactRegistry: registry,
        messageArtifacts: msgArtifacts,
        streamArtifactIds: [],
      };
    }),
}));
