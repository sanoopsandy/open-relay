import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useArtifactStore } from '../stores/artifactStore';
import type { Message } from '../../shared/types';

interface StreamDeltaPayload {
  conversationId: string;
  delta: string;
}

interface StreamDonePayload {
  conversationId: string;
  message: Message;
}

interface StreamErrorPayload {
  conversationId: string;
  error: string;
}

function isActiveConversation(conversationId: string): boolean {
  return useChatStore.getState().activeConversationId === conversationId;
}

async function refreshConversationList(): Promise<void> {
  try {
    const convs = await window.relay.invoke('chat:listConversations');
    useChatStore.getState().setConversations(convs);
  } catch {
    // Non-fatal — sidebar list may be stale until next load
  }
}

/**
 * Subscribe to streaming IPC events and update chatStore accordingly.
 * Mount once at app level (PanelLayout). Uses getState() so events are not
 * dropped when activeConversationId changes between render and effect.
 */
export function useStream(): void {
  useEffect(() => {
    const unsubDelta = window.relay.on('stream:delta', (payload) => {
      const { conversationId, delta } = payload as StreamDeltaPayload;
      if (isActiveConversation(conversationId)) {
        useChatStore.getState().appendStreamDelta(delta);
      }
    });

    const unsubDone = window.relay.on('stream:done', (payload) => {
      const { conversationId, message } = payload as StreamDonePayload;
      if (isActiveConversation(conversationId)) {
        useChatStore.getState().finalizeStream(message);
        useArtifactStore.getState().finalizeStuckArtifacts(); // clear any artifact stuck on "writing…"
        useArtifactStore.getState().associateArtifactsWithMessage(message.id);
      }
      void refreshConversationList();
    });

    const unsubError = window.relay.on('stream:error', (payload) => {
      const { conversationId, error } = payload as StreamErrorPayload;
      if (isActiveConversation(conversationId)) {
        useChatStore.getState().setError(error);
      }
    });

    return () => {
      unsubDelta();
      unsubDone();
      unsubError();
    };
  }, []);
}
