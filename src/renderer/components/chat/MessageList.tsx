import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore } from '../../stores/chatStore';
import { useArtifactStore } from '../../stores/artifactStore';
import { useLayoutStore } from '../../stores/layoutStore';
import type { Message } from '../../../shared/types';

function langColor(lang: string): string {
  const map: Record<string, string> = {
    python: '#3B82F6', py: '#3B82F6',
    javascript: '#F59E0B', js: '#F59E0B',
    typescript: '#60A5FA', ts: '#60A5FA',
    html: '#F97316', css: '#A78BFA',
    json: '#34D399', yaml: '#34D399', yml: '#34D399',
    bash: '#6B7280', sh: '#6B7280',
    sql: '#EC4899', rust: '#F97316', go: '#22D3EE',
  };
  return map[lang.toLowerCase()] ?? '#9CA3AF';
}

function ArtifactCard({ artifactId }: { artifactId: string }) {
  // Read from the permanent registry — never goes away when a tab is closed
  const artifact = useArtifactStore((s) => s.artifactRegistry[artifactId]);
  const { add, artifacts, setFocusArtifactId } = useArtifactStore();
  const layout = useLayoutStore();

  if (!artifact) return null;

  return (
    <div className="mt-3 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[--border] bg-[--bg-overlay] max-w-sm">
      <div
        className="flex-none w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
        style={{ backgroundColor: `${langColor(artifact.language)}15`, color: langColor(artifact.language) }}
      >
        {'</>'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-[--text-primary] truncate">{artifact.name}</p>
        <p className="text-[10px] text-[--text-muted] capitalize">{artifact.language}</p>
      </div>
      <button
        onClick={() => {
          if (!artifacts.some((a) => a.id === artifact.id)) {
            add(artifact);
          }
          setFocusArtifactId(artifact.id);
          layout.openArtifactPane();
        }}
        className="flex-none px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[--bg-active] text-[--text-secondary] hover:bg-[--accent] hover:text-white transition-colors"
      >
        View
      </button>
    </div>
  );
}

export default function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const error = useChatStore((s) => s.error);
  const messageArtifacts = useArtifactStore((s) => s.messageArtifacts);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Conversation opened or message finalized — jump instantly, no animation
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
    }
  }, [messages]);

  // Streaming deltas — smooth follow
  useEffect(() => {
    if (isAtBottomRef.current && streamingMessage) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [streamingMessage]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8">
        <div className="text-4xl select-none">⌘</div>
        <div>
          <p className="text-[--text-primary] font-medium text-lg">How can I help?</p>
          <p className="text-[--text-muted] text-sm mt-1">
            Type a message or <kbd className="px-1.5 py-0.5 rounded bg-[--bg-input] text-xs font-mono">/</kbd> for commands
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-4 py-4 space-y-4"
    >
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          artifactIds={messageArtifacts[msg.id] ?? []}
        />
      ))}

      {/* Streaming message */}
      {isStreaming && streamingMessage && (
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-[--accent] flex-none flex items-center justify-center text-white text-xs font-bold select-none">
            H
          </div>
          <div className="flex-1 min-w-0">
            <MarkdownContent content={streamingMessage} />
            <span className="inline-block w-0.5 h-4 bg-[--accent] ml-0.5 animate-blink align-text-bottom" />
          </div>
        </div>
      )}

      {/* Thinking dots */}
      {isStreaming && !streamingMessage && (
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-[--accent] flex-none flex items-center justify-center text-white text-xs font-bold select-none">
            H
          </div>
          <div className="flex items-center gap-1 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[--text-muted] animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[--text-muted] animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[--text-muted] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      {error && (
        <div className="flex gap-3">
          <div className="w-7 h-7 rounded-full bg-red-500/20 flex-none flex items-center justify-center text-red-400 text-xs font-bold select-none mt-0.5">
            !
          </div>
          <div className="flex-1 min-w-0 py-1">
            <p className="text-red-400 text-sm leading-relaxed whitespace-pre-wrap break-words">{error}</p>
            {error.toLowerCase().includes('overload') && (
              <OverloadNudge />
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function OverloadNudge() {
  const { setActiveView } = useLayoutStore();
  return (
    <p className="mt-2 text-[12px] text-[--text-muted]">
      Claude is under heavy load.{' '}
      <button onClick={() => setActiveView('settings')} className="text-[--accent] hover:underline">
        Switch to claude-sonnet-4-5 in Settings
      </button>
      {' '}or wait a moment and retry.
    </p>
  );
}

const MEMORY_SAVED_RE = /\n\n<!-- memory-saved:(\{[^}]+\}) -->/;
const CONTEXT_STRATEGY_RE = /\n\n<!-- context-strategy:(\{[^}]+\}) -->/;

function parseMemoryBadge(content: string): { cleanContent: string; theme?: string } {
  const match = content.match(MEMORY_SAVED_RE);
  if (!match) return { cleanContent: content };
  try {
    const data = JSON.parse(match[1]) as { theme: string };
    return { cleanContent: content.slice(0, match.index), theme: data.theme };
  } catch {
    return { cleanContent: content };
  }
}

interface ContextBadgeData {
  strategy: 'graphrag' | 'fts_fallback';
  memItems: number;
  turns: number;
  summary: boolean;
  savedTokens?: number;
}

function parseContextBadge(content: string): { cleanContent: string; ctx?: ContextBadgeData } {
  const match = content.match(CONTEXT_STRATEGY_RE);
  if (!match) return { cleanContent: content };
  try {
    const data = JSON.parse(match[1]) as ContextBadgeData;
    return { cleanContent: content.slice(0, match.index), ctx: data };
  } catch {
    return { cleanContent: content };
  }
}

function MemoryBadge({ theme }: { theme: string }) {
  return (
    <div className="mt-3 flex items-center gap-1.5 text-[11px] border-t border-[--border] pt-2.5 text-[--text-muted]">
      <svg className="w-3 h-3 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <span>Saved to memory —</span>
      <span className="font-medium text-[--text-secondary]">{theme}</span>
    </div>
  );
}

function ContextBadge({ ctx }: { ctx: ContextBadgeData }) {
  const isGraph = ctx.strategy === 'graphrag';
  const parts: string[] = [];
  if (ctx.memItems > 0) parts.push(`${ctx.memItems} memory item${ctx.memItems !== 1 ? 's' : ''}`);
  if (ctx.turns > 0) parts.push(`${ctx.turns} past session${ctx.turns !== 1 ? 's' : ''}`);
  if (ctx.summary) parts.push('session summary');
  const detail = parts.length > 0 ? parts.join(' · ') : null;

  return (
    <div className="mt-2.5 flex items-center gap-1.5 text-[11px] border-t border-[--border] pt-2 text-[--text-muted]">
      {isGraph ? (
        <svg className="w-3 h-3 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ) : (
        <svg className="w-3 h-3 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )}
      <span>{isGraph ? 'GraphRAG' : 'Memory search'}</span>
      {detail && <span className="text-[--text-muted]/60">—</span>}
      {detail && <span className="text-[--text-secondary]">{detail}</span>}
      {ctx.savedTokens && ctx.savedTokens > 200 && (
        <span className="text-[--accent]/80">· saved ~{ctx.savedTokens.toLocaleString()} tokens</span>
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none text-[--text-primary] leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px] [&_thead_th]:bg-[--bg-input] [&_thead_th]:text-[--text-primary] [&_thead_th]:font-semibold [&_thead_th]:px-3 [&_thead_th]:py-2 [&_thead_th]:border [&_thead_th]:border-[--border] [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-[--border] [&_td]:text-[--text-primary] [&_tr:nth-child(even)_td]:bg-[--bg-overlay]">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Inline code stays compact
        code({ children, className, ...props }) {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return (
              <code
                className={[className, 'block bg-[--bg-input] rounded-lg px-4 py-3 text-[11px] font-mono overflow-x-auto whitespace-pre'].join(' ')}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className="bg-[--bg-input] border border-[--border] rounded px-1 py-0.5 text-[11px] font-mono text-[--text-primary]"
              {...props}
            >
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <pre className="not-prose my-3 overflow-x-auto">{children}</pre>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
}

function MessageBubble({ message, artifactIds }: { message: Message; artifactIds: string[] }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    const { cleanContent, theme } = parseMemoryBadge(message.content);
    return (
      <div className="flex gap-3">
        <div className="w-7 h-7 rounded-full bg-[--accent] flex-none flex items-center justify-center text-white text-xs font-bold select-none mt-0.5">
          H
        </div>
        <div className="flex-1 min-w-0">
          <MarkdownContent content={cleanContent} />
          {theme && <MemoryBadge theme={theme} />}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-[--accent] text-white text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  // Strip both badge types in sequence
  const { cleanContent: afterMem, theme: memTheme } = parseMemoryBadge(message.content);
  const { cleanContent, ctx: ctxBadge } = parseContextBadge(afterMem);
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-[--accent] flex-none flex items-center justify-center text-white text-xs font-bold select-none mt-0.5">
        H
      </div>
      <div className="flex-1 min-w-0">
        <MarkdownContent content={cleanContent} />
        {memTheme && <MemoryBadge theme={memTheme} />}
        {ctxBadge && <ContextBadge ctx={ctxBadge} />}
        {artifactIds.map((id) => (
          <ArtifactCard key={id} artifactId={id} />
        ))}
      </div>
    </div>
  );
}
