import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import { useArtifactStore } from '../../stores/artifactStore';
import { useLayoutStore } from '../../stores/layoutStore';

function langColor(lang: string): string {
  const map: Record<string, string> = {
    python: '#3B82F6', py: '#3B82F6',
    javascript: '#D97706', js: '#D97706',
    typescript: '#2563EB', ts: '#2563EB',
    html: '#EA580C', css: '#7C3AED',
    json: '#059669', yaml: '#059669', yml: '#059669',
    bash: '#6B7280', sh: '#6B7280',
    sql: '#DB2777', rust: '#EA580C', go: '#0891B2',
  };
  return map[lang.toLowerCase()] ?? '#6B7280';
}

async function downloadArtifact(name: string, content: string) {
  await window.relay.invoke('artifact:download', { name, content });
}

type ViewMode = 'preview' | 'code';

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const highlighted = useMemo(() => {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      return code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [code, language]);

  return (
    <pre
      className="flex-1 overflow-auto m-0 rounded-none bg-white"
      style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: '1.65' }}
    >
      {/* highlight.js output is safe — only adds span elements with class names */}
      <code
        className={`hljs language-${language} block px-5 py-4`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}

export default function ArtifactPane() {
  const { artifacts, streamingIds, remove, focusArtifactId, setFocusArtifactId } = useArtifactStore();
  const layout = useLayoutStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');

  useEffect(() => {
    if (artifacts.length === 0) { setActiveId(null); return; }
    if (activeId && artifacts.some((a) => a.id === activeId)) return;
    const latest = artifacts[artifacts.length - 1];
    setActiveId(latest.id);
    setViewMode(latest.language === 'html' ? 'preview' : 'code');
  }, [artifacts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusArtifactId) return;
    const a = artifacts.find((x) => x.id === focusArtifactId);
    if (a) {
      setActiveId(a.id);
      setViewMode(a.language === 'html' ? 'preview' : 'code');
    }
    setFocusArtifactId(null);
  }, [focusArtifactId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabSelect = useCallback((id: string) => {
    setActiveId(id);
    const a = artifacts.find((x) => x.id === id);
    setViewMode(a?.language === 'html' ? 'preview' : 'code');
  }, [artifacts]);

  const handleTabClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const idx = artifacts.findIndex((a) => a.id === id);
    remove(id);
    if (id === activeId) {
      const remaining = artifacts.filter((a) => a.id !== id);
      if (remaining.length === 0) {
        layout.closeArtifactPane();
      } else {
        const next = remaining[Math.max(0, idx - 1)];
        setActiveId(next.id);
        setViewMode(next.language === 'html' ? 'preview' : 'code');
      }
    }
  }, [artifacts, activeId, remove, layout]);

  const active = artifacts.find((a) => a.id === activeId) ?? null;
  const isHtml = active?.language === 'html';
  const isStreaming = active ? streamingIds.has(active.id) : false;

  // Auto-scroll streaming code view to bottom
  const streamCodeRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (isStreaming && streamCodeRef.current) {
      streamCodeRef.current.scrollTop = streamCodeRef.current.scrollHeight;
    }
  }, [active?.content, isStreaming]);

  return (
    <div className="h-full flex flex-col bg-[--bg-base] text-[--text-primary] text-xs border-l border-[--border]">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[--border] bg-[--bg-sidebar] flex-none">
        <svg className="w-3.5 h-3.5 text-[--text-muted] flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-[--text-secondary] font-semibold text-[11px] tracking-widest uppercase flex-1">
          Artifacts
        </span>
        {active?.content && (
          <button
            onClick={() => void downloadArtifact(active.name, active.content)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-[--text-secondary] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
            title="Download file"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>
        )}
        <button
          onClick={() => layout.closeArtifactPane()}
          className="px-1.5 py-1 rounded text-[11px] text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
          title="Close artifact pane"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      {artifacts.length > 0 && (
        <div
          className="flex gap-0.5 px-2 pt-2 pb-0 border-b border-[--border] flex-none overflow-x-auto bg-[--bg-sidebar]"
          style={{ scrollbarWidth: 'none' }}
        >
          {artifacts.map((a) => (
            <div
              key={a.id}
              onClick={() => handleTabSelect(a.id)}
              className={[
                'flex-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-[10px] transition-colors border-b-2 cursor-pointer group/tab',
                a.id === activeId
                  ? 'bg-[--bg-base] text-[--text-primary] border-[--accent]'
                  : 'bg-transparent text-[--text-muted] border-transparent hover:text-[--text-secondary] hover:bg-[--bg-hover]',
              ].join(' ')}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-none"
                style={{ backgroundColor: langColor(a.language) }}
              />
              <span className="max-w-[90px] truncate">{a.name}</span>
              {!a.content && (
                <span className="text-[9px] text-[--text-muted] italic">…</span>
              )}
              <button
                onClick={(e) => handleTabClose(e, a.id)}
                className="flex-none ml-0.5 w-3 h-3 flex items-center justify-center rounded text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-active] opacity-0 group-hover/tab:opacity-100 transition-all"
                title="Close tab"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {!active ? (
          <div className="flex items-center justify-center h-full text-[--text-muted] text-[11px]">
            No artifacts yet
          </div>
        ) : isStreaming ? (
          /* Live streaming view */
          <div className="flex flex-col h-full min-h-0">
            {/* Streaming status bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[--border] flex-none bg-[--bg-overlay]">
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: langColor(active.language) }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ backgroundColor: langColor(active.language) }}
                />
              </span>
              <span className="text-[--text-primary] text-[11px] flex-1 truncate font-medium">{active.name}</span>
              {active.content && (
                <span className="text-[--text-muted] text-[10px]">
                  {active.content.split('\n').length} lines · {(active.content.length / 1024).toFixed(1)} KB
                </span>
              )}
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium animate-pulse"
                style={{ backgroundColor: `${langColor(active.language)}15`, color: langColor(active.language) }}>
                writing…
              </span>
            </div>
            {/* Live code preview — scrolls to bottom as content arrives */}
            <pre
              ref={streamCodeRef}
              className="flex-1 overflow-auto m-0 bg-[--bg-base] px-5 py-4"
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', lineHeight: '1.65', color: 'var(--text-secondary)' }}
            >
              {active.content || ''}
            </pre>
          </div>
        ) : (
          <div className="flex flex-col h-full min-h-0">
            {/* Metadata bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[--border] flex-none bg-[--bg-overlay]">
              <span
                className="w-2 h-2 rounded-full flex-none"
                style={{ backgroundColor: langColor(active.language) }}
              />
              <span className="text-[--text-primary] text-[11px] flex-1 truncate font-medium">{active.name}</span>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${langColor(active.language)}15`, color: langColor(active.language) }}
              >
                {active.language}
              </span>
              {isHtml ? (
                <div className="flex gap-0.5 bg-[--bg-input] rounded p-0.5">
                  <button
                    onClick={() => setViewMode('preview')}
                    className={['px-2 py-0.5 rounded text-[10px] transition-colors font-medium',
                      viewMode === 'preview'
                        ? 'bg-[--bg-base] text-[--text-primary] shadow-sm'
                        : 'text-[--text-muted] hover:text-[--text-secondary]'
                    ].join(' ')}
                  >Preview</button>
                  <button
                    onClick={() => setViewMode('code')}
                    className={['px-2 py-0.5 rounded text-[10px] transition-colors font-medium',
                      viewMode === 'code'
                        ? 'bg-[--bg-base] text-[--text-primary] shadow-sm'
                        : 'text-[--text-muted] hover:text-[--text-secondary]'
                    ].join(' ')}
                  >Code</button>
                </div>
              ) : (
                <span className="text-[--text-muted] text-[10px]">
                  {active.content.split('\n').length} lines
                </span>
              )}
            </div>

            {/* Content view */}
            {isHtml && viewMode === 'preview' ? (
              <iframe
                key={activeId}
                srcDoc={active.content}
                sandbox="allow-scripts allow-same-origin"
                className="flex-1 w-full border-none bg-white"
                title={active.name}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-auto bg-white">
                <HighlightedCode code={active.content} language={active.language} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
