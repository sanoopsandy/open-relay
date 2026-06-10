import React, { useEffect, useCallback } from 'react';
import type { HarnessConfig, Conversation, Message } from '../../../shared/types';
import { useChatStore } from '../../stores/chatStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useArtifactStore } from '../../stores/artifactStore';
import MessageList from './MessageList';
import MessageComposer from './MessageComposer';

interface ChatPanelProps {
  config: HarnessConfig;
}

let startupConversationPromise: Promise<string> | null = null;

export default function ChatPanel({ config }: ChatPanelProps) {
  const {
    activeConversationId,
    setActiveConversation,
    setMessages,
    appendMessage,
    setStreaming,
    setError,
    isStreaming,
  } = useChatStore();

  const layout = useLayoutStore();
  const {
    artifacts,
    add: addArtifact,
    updateContent: updateArtifactContent,
    clear: clearArtifacts,
    switchConversation,
    trackStreamArtifact,
    loadPersisted,
  } = useArtifactStore();

  // Start a fresh conversation on mount if none active
  useEffect(() => {
    if (!activeConversationId) {
      void ensureInitialConversation();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Artifact IPC subscriptions
  useEffect(() => {
    const unsubCreated = window.relay.on('artifact:created', (payload) => {
      const { id, name, language } = payload as { id: string; name: string; language: string };
      addArtifact({ id, name, language, content: '' });
      layout.openArtifactPane();
    });

    const unsubDelta = window.relay.on('artifact:delta', (payload) => {
      const { id, content } = payload as { id: string; content: string };
      updateArtifactContent(id, content);
    });

    const unsubFinalized = window.relay.on('artifact:finalized', (payload) => {
      const artifact = payload as { id: string; name: string; language: string; content: string };
      addArtifact(artifact);
      trackStreamArtifact(artifact.id);
    });

    return () => {
      unsubCreated();
      unsubDelta();
      unsubFinalized();
    };
  }, [addArtifact, updateArtifactContent, layout.openArtifactPane]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for new/clear conversation requests
  useEffect(() => {
    const unsub = window.relay.on('chat:newConversation', () => {
      void createNewConversation();
    });

    const unsubClear = window.relay.on('chat:clearConversation', () => {
      if (activeConversationId) {
        setMessages([]);
        clearArtifacts();
      }
    });

    const unsubSystem = window.relay.on('chat:systemMessage', (payload) => {
      const { content } = payload as { content: string };
      const msg: Message = {
        id: crypto.randomUUID(),
        role: 'system',
        content,
        created_at: Date.now(),
      };
      appendMessage(msg);
    });

    return () => {
      unsub();
      unsubClear();
      unsubSystem();
    };
  }, [activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch artifact context and reload persisted artifacts when conversation changes
  useEffect(() => {
    if (!activeConversationId) return;
    switchConversation(activeConversationId);
    window.relay
      .invoke('artifact:listByConversation', activeConversationId)
      .then((persisted) => {
        const list = persisted as import('../../../shared/types').PersistedArtifact[];
        loadPersisted(list);
        if (list.length > 0) layout.openArtifactPane();
      })
      .catch(console.error);
  }, [activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureInitialConversation() {
    const current = useChatStore.getState().activeConversationId;
    if (current) return;

    if (!startupConversationPromise) {
      startupConversationPromise = (async () => {
        const convs = await window.relay.invoke<Array<{ id: string }>>('chat:listConversations');
        if (convs.length > 0) return convs[0].id;
        return window.relay.invoke<string>('chat:createConversation');
      })().finally(() => {
        startupConversationPromise = null;
      });
    }

    try {
      const id = await startupConversationPromise;
      if (!useChatStore.getState().activeConversationId) {
        setActiveConversation(id);
      }
    } catch (err) {
      console.error('Failed to initialize conversation:', err);
    }
  }

  async function createNewConversation() {
    try {
      const id = await window.relay.invoke<string>('chat:createConversation');
      setActiveConversation(id);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }

  const handleSend = useCallback(
    async (message: string, attachmentPaths?: string[]) => {
      if (!activeConversationId || isStreaming) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        created_at: Date.now(),
      };
      appendMessage(userMsg);
      setStreaming(true);
      setError(null);

      try {
        await window.relay.invoke('chat:sendMessage', activeConversationId, message, attachmentPaths);

        const state = useChatStore.getState();
        if (state.isStreaming) {
          const conv = await window.relay.invoke<Conversation | null>(
            'chat:getConversation',
            activeConversationId
          );
          if (conv?.messages) {
            useChatStore.getState().setMessages(conv.messages);
          }
          useChatStore.getState().setStreaming(false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStreaming(false);
      }
    },
    [activeConversationId, isStreaming, appendMessage, setStreaming, setError]
  );

  return (
    <div className="flex flex-col h-full bg-[--bg-chat]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[--border] bg-[--bg-base] drag-region">
        <div className="flex items-center gap-2">
          {!layout.sidebarOpen && (
            <button
              onClick={() => layout.toggleSidebar()}
              className="p-1.5 rounded text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors no-drag"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <span className="text-sm font-medium text-[--text-secondary]">
            {config.ai.provider === 'claude' ? 'Claude' : config.ai.provider} · {config.ai.model}
          </span>
        </div>
        <div className="flex items-center gap-1 no-drag">
          {/* Reopen artifact pane when closed but artifacts exist */}
          {!layout.artifactPaneOpen && artifacts.length > 0 && (
            <button
              onClick={() => layout.openArtifactPane()}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-[--bg-hover] transition-colors"
              title="Show artifacts"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Artifacts ({artifacts.length})</span>
            </button>
          )}
          <button
            onClick={() => layout.toggleLogViewer()}
            className={[
              'p-1.5 rounded text-xs transition-colors',
              layout.logViewerOpen
                ? 'text-[--accent] bg-[--bg-active]'
                : 'text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover]',
            ].join(' ')}
            title="Toggle logs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0">
        <MessageList />
      </div>

      {/* Generating indicator */}
      {isStreaming && artifacts.some((a) => !a.content) && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-[--border] bg-[--bg-base] text-[11px] text-neutral-500 flex-none">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-pulse flex-none" />
          {(() => {
            const pending = artifacts.filter((a) => !a.content);
            return pending.length === 1
              ? `Generating ${pending[0].name}…`
              : `Generating ${pending.length} files…`;
          })()}
        </div>
      )}

      {/* Composer */}
      <div className="flex-none">
        <MessageComposer
          onSend={handleSend}
          disabled={isStreaming || !activeConversationId}
          conversationId={activeConversationId ?? undefined}
        />
      </div>
    </div>
  );
}
