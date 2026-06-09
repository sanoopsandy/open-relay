import { create } from 'zustand';
import type { Message, ConversationSummary } from '../../shared/types';

interface ChatState {
  // Data
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: Message[];
  streamingMessage: string;
  isStreaming: boolean;
  error: string | null;

  // Actions
  setConversations: (conversations: ConversationSummary[]) => void;
  addConversation: (conv: ConversationSummary) => void;
  removeConversation: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;

  setActiveConversation: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  appendMessage: (message: Message) => void;

  appendStreamDelta: (delta: string) => void;
  finalizeStream: (message: Message) => void;
  setStreaming: (isStreaming: boolean) => void;
  setError: (error: string | null) => void;

  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  streamingMessage: '',
  isStreaming: false,
  error: null,

  setConversations: (conversations) => set({ conversations }),

  addConversation: (conv) =>
    set((state) => ({
      conversations: [conv, ...state.conversations.filter((c) => c.id !== conv.id)],
    })),

  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId:
        state.activeConversationId === id ? null : state.activeConversationId,
    })),

  updateConversationTitle: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    })),

  setActiveConversation: (id) =>
    set({
      activeConversationId: id,
      messages: [],
      streamingMessage: '',
      isStreaming: false,
      error: null,
    }),

  setMessages: (messages) => set({ messages }),

  appendMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  appendStreamDelta: (delta) =>
    set((state) => ({ streamingMessage: state.streamingMessage + delta, isStreaming: true })),

  finalizeStream: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
      streamingMessage: '',
      isStreaming: false,
    })),

  setStreaming: (isStreaming) => set({ isStreaming }),

  setError: (error) => set({ error, isStreaming: false }),

  reset: () =>
    set({
      messages: [],
      streamingMessage: '',
      isStreaming: false,
      error: null,
    }),
}));
