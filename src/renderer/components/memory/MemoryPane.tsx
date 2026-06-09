import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MemoryItem } from '../../../shared/types';
import { useMemoryStore } from '../../stores/memoryStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useArtifactStore } from '../../stores/artifactStore';

const PAGE_SIZE = 15;

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MemoryPane() {
  const {
    themes, activeTheme, items, loading,
    setThemes, setActiveTheme, setItems, setLoading,
    removeItem, addItem, addThemeIfMissing,
  } = useMemoryStore();
  const layout = useLayoutStore();
  const { artifacts } = useArtifactStore();

  const [addOpen, setAddOpen] = useState(false);
  const [newTheme, setNewTheme] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  // Load themes on mount
  useEffect(() => {
    window.relay
      .invoke<string[]>('memory:listThemes')
      .then((t) => setThemes(t))
      .catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates from slash commands
  useEffect(() => {
    const unsubAdded = window.relay.on('memory:itemAdded', (payload) => {
      const item = payload as MemoryItem;
      addThemeIfMissing(item.theme);
      void window.relay.invoke<string[]>('memory:listThemes').then(setThemes).catch(console.error);
      const { activeTheme: cur } = useMemoryStore.getState();
      if (cur === null || cur === item.theme) addItem(item);
    });

    const unsubSelect = window.relay.on('memory:selectTheme', (payload) => {
      const { theme } = payload as { theme: string };
      addThemeIfMissing(theme);
      setActiveTheme(theme);
    });

    return () => { unsubAdded(); unsubSelect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load items when active theme changes
  useEffect(() => {
    setLoading(true);
    setPage(1);
    setExpandedIds(new Set());

    if (activeTheme === null) {
      // All themes — load in parallel and merge by recency
      window.relay.invoke<string[]>('memory:listThemes')
        .then(async (allThemes) => {
          if (allThemes.length === 0) { setItems([]); return; }
          const results = await Promise.all(
            allThemes.map(t => window.relay.invoke<MemoryItem[]>('memory:getByTheme', t))
          );
          setItems(results.flat().sort((a, b) => b.created_at - a.created_at));
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      window.relay
        .invoke<MemoryItem[]>('memory:getByTheme', activeTheme)
        .then(setItems)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [activeTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page on search or theme change
  useEffect(() => { setPage(1); }, [searchQuery, activeTheme]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(i =>
      i.content.toLowerCase().includes(q) || i.theme.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allPageExpanded = pagedItems.length > 0 && pagedItems.every(i => expandedIds.has(i.id));

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (allPageExpanded) pagedItems.forEach(i => next.delete(i.id));
      else pagedItems.forEach(i => next.add(i.id));
      return next;
    });
  }, [allPageExpanded, pagedItems]);

  const handleCopy = useCallback(async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedIds(prev => new Set(prev).add(id));
    setTimeout(() => setCopiedIds(prev => { const next = new Set(prev); next.delete(id); return next; }), 1500);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.relay.invoke('memory:deleteItem', id);
      removeItem(id);
      setExpandedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err) {
      console.error('Failed to delete memory item', err);
    }
  }, [removeItem]);

  const handleSave = useCallback(async () => {
    const theme = newTheme.trim();
    const content = newContent.trim();
    if (!theme || !content) return;
    setSaving(true);
    try {
      const item = await window.relay.invoke<MemoryItem>('memory:add', { theme, content });
      addThemeIfMissing(item.theme);
      void window.relay.invoke<string[]>('memory:listThemes').then(setThemes).catch(console.error);
      if (activeTheme === null || activeTheme === item.theme) addItem(item);
      setNewTheme('');
      setNewContent('');
      setAddOpen(false);
    } catch (err) {
      console.error('Failed to save memory item', err);
    } finally {
      setSaving(false);
    }
  }, [newTheme, newContent, activeTheme, addItem, addThemeIfMissing, setThemes]);

  return (
    <div className="h-full flex flex-col bg-[--bg-base] text-xs" style={{ fontFamily: 'ui-monospace, monospace' }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[--border] bg-[--bg-sidebar] flex-none">
        <span className="text-[--text-primary] font-semibold text-[11px] tracking-widest uppercase">Memory</span>
        <div className="flex-1" />
        <button
          onClick={() => setAddOpen(v => !v)}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-[--text-secondary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
        >
          {addOpen ? 'Cancel' : '+ Add'}
        </button>
        <button
          onClick={() => {
            layout.setMemoryPaneOpen(false);
            if (artifacts.length > 0) layout.openArtifactPane();
          }}
          className="px-1.5 py-1 rounded text-[11px] text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
          title="Close memory pane"
        >
          ✕
        </button>
      </div>

      {/* Theme pills */}
      <div
        className="flex gap-1.5 px-4 py-2.5 border-b border-[--border] flex-none overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <button
          onClick={() => setActiveTheme(null)}
          className={[
            'flex-none px-3 py-1 rounded-full text-[10px] font-medium transition-colors',
            activeTheme === null
              ? 'bg-[--bg-active] text-[--text-primary]'
              : 'bg-[--bg-input] text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]',
          ].join(' ')}
        >
          All
        </button>
        {themes.map(t => (
          <button
            key={t}
            onClick={() => setActiveTheme(t)}
            className={[
              'flex-none px-3 py-1 rounded-full text-[10px] font-medium transition-colors',
              activeTheme === t
                ? 'bg-[--bg-active] text-[--text-primary]'
                : 'bg-[--bg-input] text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary]',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="px-4 py-2.5 border-b border-[--border] flex-none">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--text-muted] w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="6" r="4.5" /><path d="M10 10l3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search memories…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[--bg-base] border border-[--border] rounded-md pl-7 pr-7 py-1.5 text-[11px] text-[--text-primary] placeholder-[--text-muted] focus:outline-none focus:border-[--border-focus] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[--text-muted] hover:text-[--text-secondary] text-[11px] transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center px-4 py-1.5 border-b border-[--border] flex-none">
        <span className="text-[--text-muted] text-[10px]">
          {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
          {searchQuery && ` · "${searchQuery}"`}
        </span>
        <div className="flex-1" />
        {pagedItems.length > 0 && (
          <button
            onClick={toggleExpandAll}
            className="text-[10px] text-[--text-muted] hover:text-[--text-secondary] transition-colors"
          >
            {allPageExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {/* Add form */}
      {addOpen && (
        <div className="flex flex-col gap-2 px-4 py-3 border-b border-[--border] bg-[--bg-overlay] flex-none">
          <input
            type="text"
            placeholder="theme (e.g. business)"
            value={newTheme}
            onChange={e => setNewTheme(e.target.value)}
            className="w-full bg-[--bg-base] border border-[--border] rounded px-2.5 py-1.5 text-[--text-primary] placeholder-[--text-muted] text-[11px] focus:outline-none focus:border-[--border-focus]"
            list="memory-themes"
          />
          <datalist id="memory-themes">
            {themes.map(t => <option key={t} value={t} />)}
          </datalist>
          <textarea
            placeholder="content…"
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            rows={3}
            className="w-full bg-[--bg-base] border border-[--border] rounded px-2.5 py-1.5 text-[--text-primary] placeholder-[--text-muted] text-[11px] resize-none focus:outline-none focus:border-[--border-focus]"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSave(); }}
          />
          <button
            onClick={() => void handleSave()}
            disabled={saving || !newTheme.trim() || !newContent.trim()}
            className="self-end px-3 py-1 rounded text-[11px] bg-[--accent] text-white hover:bg-[--accent-hover] disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save ⌘↵'}
          </button>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-[--text-muted] text-[10px] py-8 text-center">Loading…</p>
        )}

        {!loading && pagedItems.length === 0 && (
          <p className="text-[--text-muted] text-[10px] py-8 text-center leading-relaxed">
            {searchQuery
              ? `No memories match "${searchQuery}"`
              : themes.length === 0
                ? 'No memories yet.\nUse + Add or /add-to-memory <theme> <text>'
                : 'No items in this theme'}
          </p>
        )}

        {!loading && pagedItems.map((item) => {
          const expanded = expandedIds.has(item.id);
          const copied = copiedIds.has(item.id);
          return (
            <div key={item.id} className="border-b border-[--border] last:border-0 group/row">
              <div className="flex items-start gap-2 px-4 py-3 hover:bg-[--bg-hover] transition-colors">
                <span className="text-[--text-muted] text-[10px] flex-none w-14 text-right mt-0.5 shrink-0 tabular-nums">
                  {relativeTime(item.created_at)}
                </span>
                <div className="flex-1 min-w-0">
                  {expanded ? (
                    <div className="prose prose-sm prose-invert max-w-none text-[--text-primary] text-[12px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[11px] [&_code]:bg-[--bg-input] [&_code]:px-1 [&_code]:rounded [&_table]:w-full [&_table]:border-collapse [&_thead_th]:bg-[--bg-input] [&_thead_th]:text-[--text-primary] [&_thead_th]:font-semibold [&_thead_th]:px-2 [&_thead_th]:py-1.5 [&_thead_th]:border [&_thead_th]:border-[--border] [&_td]:px-2 [&_td]:py-1.5 [&_td]:border [&_td]:border-[--border] [&_td]:text-[--text-primary] [&_tr:nth-child(even)_td]:bg-[--bg-overlay]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div
                      className="text-[--text-primary] text-[12px] leading-relaxed cursor-pointer"
                      style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                      onClick={() => toggleExpand(item.id)}
                    >
                      {item.content}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 flex-none opacity-0 group-hover/row:opacity-100 transition-all mt-0.5 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); void handleCopy(item.id, item.content); }}
                    className="text-[--text-muted] hover:text-[--text-primary] transition-colors p-0.5 rounded"
                    title="Copy"
                  >
                    {copied ? (
                      <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="text-[--text-muted] hover:text-[--text-primary] transition-colors p-0.5 rounded"
                    title={expanded ? 'Collapse' : 'Expand'}
                  >
                    <svg className={`w-3 h-3 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); void handleDelete(item.id); }}
                    className="text-[--text-muted] hover:text-red-500 transition-all text-[10px] px-1"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[--border] flex-none">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-[10px] text-[--text-muted] hover:text-[--text-secondary] disabled:opacity-30 disabled:cursor-default transition-colors"
          >
            ← Prev
          </button>
          <span className="text-[10px] text-[--text-muted] tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-[10px] text-[--text-muted] hover:text-[--text-secondary] disabled:opacity-30 disabled:cursor-default transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
