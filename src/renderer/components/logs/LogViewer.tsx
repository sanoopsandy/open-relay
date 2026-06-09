import React, { useEffect, useRef } from 'react';
import { useLogStore } from '../../stores/logStore';
import { useLayoutStore } from '../../stores/layoutStore';

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const LEVEL_COLORS: Record<number, string> = {
  10: 'text-neutral-500',
  20: 'text-blue-400',
  30: 'text-green-400',
  40: 'text-yellow-400',
  50: 'text-red-400',
  60: 'text-red-600',
};

export default function LogViewer() {
  const lines = useLogStore((s) => s.lines);
  const isStreaming = useLogStore((s) => s.isStreaming);
  const clearLines = useLogStore((s) => s.clearLines);
  const layout = useLayoutStore();

  const [filter, setFilter] = React.useState('');
  const [minLevel, setMinLevel] = React.useState(20);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines]);

  const filteredLines = lines.filter((l) => {
    if (l.level < minLevel) return false;
    if (!filter) return true;
    const searchTarget = `${LEVEL_LABELS[l.level] ?? ''} ${l.category ?? ''} ${l.msg}`.toLowerCase();
    return searchTarget.includes(filter.toLowerCase());
  });

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  return (
    <div className="h-full flex flex-col bg-[#1a1917] font-mono text-xs border-t border-[--border]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2a2927] bg-[#131210] flex-none">
        <span className="text-[#888580] font-semibold text-[10px] uppercase tracking-wider">
          Logs
        </span>
        {isStreaming && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        )}
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="flex-1 bg-[#222120] border border-[#2a2927] rounded px-2 py-0.5 text-[#c8c5be] placeholder-[#555350] outline-none focus:border-[#444240] text-[11px]"
        />
        <select
          value={minLevel}
          onChange={(e) => setMinLevel(Number(e.target.value))}
          className="bg-[#222120] border border-[#2a2927] rounded px-1.5 py-0.5 text-[#c8c5be] text-[11px] outline-none"
        >
          <option value={10}>TRACE+</option>
          <option value={20}>DEBUG+</option>
          <option value={30}>INFO+</option>
          <option value={40}>WARN+</option>
          <option value={50}>ERROR+</option>
        </select>
        <button
          onClick={clearLines}
          className="px-2 py-0.5 rounded text-[11px] text-[#888580] hover:text-[#c8c5be] hover:bg-[#2a2927] transition-colors"
        >
          Clear
        </button>
        <button
          onClick={() => layout.setLogViewerOpen(false)}
          className="p-1 rounded text-[#555350] hover:text-[#c8c5be] hover:bg-[#2a2927] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {filteredLines.length === 0 && (
          <div className="text-[#555350] text-[11px] py-4 text-center">
            {lines.length === 0 ? 'No logs yet' : 'No matches'}
          </div>
        )}
        {filteredLines.map((line, i) => (
          <div key={i} className="flex items-start gap-2 leading-relaxed">
            <span className="text-[#555350] flex-none w-20 truncate">
              {formatTime(line.time)}
            </span>
            <span
              className={`flex-none w-10 text-right ${LEVEL_COLORS[line.level] ?? 'text-[#888580]'}`}
            >
              {LEVEL_LABELS[line.level]?.slice(0, 3) ?? '???'}
            </span>
            {line.category && (
              <span className="flex-none text-blue-400/70 w-16 truncate">{line.category}</span>
            )}
            <span className="text-[#c8c5be] break-all">{line.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
