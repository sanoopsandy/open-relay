import React, { useEffect, useState } from 'react';
import type { HarnessConfig, ConversationSummary, Conversation } from '../../../shared/types';
import { useChatStore } from '../../stores/chatStore';
import { useLayoutStore } from '../../stores/layoutStore';

interface SidebarProps {
  config: HarnessConfig;
}

export default function Sidebar({ config: _config }: SidebarProps) {
  const {
    conversations,
    activeConversationId,
    setConversations,
    setActiveConversation,
    removeConversation,
    setMessages,
    updateConversationTitle,
  } = useChatStore();

  const layout = useLayoutStore();
  const [artifactConvIds, setArtifactConvIds] = useState<Set<string>>(new Set());

  // Load conversations on mount and on new-conversation events
  useEffect(() => {
    loadConversations();
    loadArtifactIds();

    const unsubNew = window.relay.on('chat:newConversation', () => {
      loadConversations();
    });

    const unsubTitle = window.relay.on('conversation:titleUpdated', (payload) => {
      const { conversationId, title } = payload as { conversationId: string; title: string };
      updateConversationTitle(conversationId, title);
    });

    // When a new artifact is finalized, mark that conversation as having artifacts
    const unsubArtifact = window.relay.on('artifact:finalized', () => {
      if (activeConversationId) {
        setArtifactConvIds((prev) => new Set([...prev, activeConversationId]));
      }
    });

    return () => { unsubNew(); unsubTitle(); unsubArtifact(); };
  }, [updateConversationTitle, activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadArtifactIds() {
    try {
      const ids = await window.relay.invoke<string[]>('artifact:conversationsWithArtifacts');
      setArtifactConvIds(new Set(ids));
    } catch {
      // non-critical — sidebar still works without indicators
    }
  }

  async function loadConversations() {
    try {
      const convs = await window.relay.invoke<ConversationSummary[]>('chat:listConversations');
      setConversations(convs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  async function handleNewChat() {
    try {
      const id = await window.relay.invoke<string>('chat:createConversation');
      await loadConversations();
      setActiveConversation(id);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }

  async function handleSelectConversation(id: string) {
    try {
      const conv = await window.relay.invoke<Conversation | null>(
        'chat:getConversation',
        id
      );
      setActiveConversation(id);
      layout.setActiveView('chat');
      if (conv) {
        setMessages(conv.messages ?? []);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }

  async function handleDeleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await window.relay.invoke('chat:deleteConversation', id);
      removeConversation(id);
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return (
    <aside className="h-full flex flex-col bg-[--bg-sidebar] border-r border-[--border]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-10 pb-3">
        <span className="text-xs font-semibold text-[--text-muted] uppercase tracking-wider">
          Relay
        </span>
        <button
          onClick={() => layout.toggleSidebar()}
          className="p-1 rounded text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
          title="Close sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* New chat button */}
      <div className="px-2 pb-2">
        <button
          onClick={() => { void handleNewChat(); layout.setActiveView('chat'); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-[--accent] text-white hover:bg-[--accent-hover] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Schedulers nav */}
      <div className="px-2 pb-1">
        <button
          onClick={() => layout.setActiveView('scheduler')}
          className={[
            'w-full flex items-center gap-2 px-3 py-2 rounded-md text-[11px] transition-colors',
            layout.activeView === 'scheduler'
              ? 'bg-[--bg-active] text-[--text-primary]'
              : 'text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]',
          ].join(' ')}
        >
          <svg className="w-3.5 h-3.5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Schedulers
        </button>
      </div>

      {/* Settings nav */}
      <div className="px-2 pb-2">
        <button
          onClick={() => layout.setActiveView('settings')}
          className={[
            'w-full flex items-center gap-2 px-3 py-2 rounded-md text-[11px] transition-colors',
            layout.activeView === 'settings'
              ? 'bg-[--bg-active] text-[--text-primary]'
              : 'text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]',
          ].join(' ')}
        >
          <svg className="w-3.5 h-3.5 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {conversations.length === 0 && (
          <div className="text-xs text-[--text-muted] text-center py-6">
            No conversations yet
          </div>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => handleSelectConversation(conv.id)}
            className={[
              'w-full text-left px-3 py-2 rounded-md text-sm group flex items-start justify-between gap-1 transition-colors',
              activeConversationId === conv.id
                ? 'bg-[--bg-active] text-[--text-primary]'
                : 'text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]',
            ].join(' ')}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium leading-tight">{conv.title}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-[--text-muted]">{formatTime(conv.updated_at)}</span>
                {artifactConvIds.has(conv.id) && (
                  <span
                    className="flex items-center gap-0.5 text-[9px] text-[--text-muted] opacity-60"
                    title="Has artifacts"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={(e) => handleDeleteConversation(e, conv.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 transition-all flex-none"
              title="Delete conversation"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </button>
        ))}
      </div>

      {/* Panel toggles */}
      <div className="p-2 border-t border-[--border] flex gap-1">
        <button
          onClick={() => layout.toggleMemoryPane()}
          className={[
            'flex-1 p-2 rounded text-xs transition-colors flex items-center justify-center gap-1',
            layout.memoryPaneOpen
              ? 'bg-[--bg-active] text-[--text-primary]'
              : 'text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover]',
          ].join(' ')}
          title="Toggle memory"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </button>
        <button
          onClick={() => layout.toggleLogViewer()}
          className={[
            'flex-1 p-2 rounded text-xs transition-colors flex items-center justify-center gap-1',
            layout.logViewerOpen
              ? 'bg-[--bg-active] text-[--text-primary]'
              : 'text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover]',
          ].join(' ')}
          title="Toggle logs"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
