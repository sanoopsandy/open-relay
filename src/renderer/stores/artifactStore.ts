import { create } from 'zustand';
import type { Artifact, PersistedArtifact } from '../../shared/types';

interface ArtifactStoreState {
  byConversation: Record<string, Artifact[]>;
  currentConversationId: string | null;
  artifacts: Artifact[]; // mirrors byConversation[currentConversationId]

  // Permanent registry — artifacts are never deleted from here, only from tabs
  artifactRegistry: Record<string, Artifact>;

  // IDs of artifacts currently streaming (created but not yet finalized)
  streamingIds: Set<string>;

  // Per-message artifact association (UUID keys → no collision across conversations)
  streamArtifactIds: string[];
  messageArtifacts: Record<string, string[]>; // messageId → artifactIds

  // Request a specific artifact to be focused when the pane opens
  focusArtifactId: string | null;

  switchConversation: (id: string) => void;
  add: (artifact: Artifact) => void;
  updateContent: (id: string, content: string) => void;
  remove: (id: string) => void;
  clear: () => void;

  trackStreamArtifact: (id: string) => void;
  associateArtifactsWithMessage: (messageId: string) => void;
  finalizeStuckArtifacts: () => void;
  setFocusArtifactId: (id: string | null) => void;
  loadPersisted: (persisted: PersistedArtifact[]) => void;
}

export const useArtifactStore = create<ArtifactStoreState>((set) => ({
  byConversation: {},
  currentConversationId: null,
  artifacts: [],

  artifactRegistry: {},
  streamingIds: new Set<string>(),

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
      // Track streaming state: no content = streaming started; content present = finalized
      const newStreamingIds = new Set(s.streamingIds);
      if (!artifact.content) {
        newStreamingIds.add(artifact.id);
      } else {
        newStreamingIds.delete(artifact.id);
      }
      return {
        byConversation: { ...s.byConversation, [convId]: updated },
        artifacts: updated,
        streamingIds: newStreamingIds,
        // Registry is permanent — only add/update, never remove
        artifactRegistry: artifact.content
          ? { ...s.artifactRegistry, [artifact.id]: artifact }
          : s.artifactRegistry,
      };
    }),

  updateContent: (id, content) =>
    set((s) => {
      const convId = s.currentConversationId ?? '';
      const existing = s.byConversation[convId] ?? [];
      const updated = existing.map((a) => (a.id === id ? { ...a, content } : a));
      return {
        byConversation: { ...s.byConversation, [convId]: updated },
        artifacts: updated,
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

  finalizeStuckArtifacts: () =>
    set((s) => {
      if (s.streamingIds.size === 0) return s;
      const convId = s.currentConversationId ?? '';
      const convArtifacts = s.byConversation[convId] ?? [];
      const registry = { ...s.artifactRegistry };
      s.streamingIds.forEach((id) => {
        const a = convArtifacts.find((x) => x.id === id);
        if (a) registry[id] = a; // persist partial content so it's viewable
      });
      return { streamingIds: new Set<string>(), artifactRegistry: registry };
    }),

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
