import React, { useEffect, useRef } from 'react';
import type { SlashCommand } from '../../../shared/types';

interface CommandPaletteProps {
  results: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export default function CommandPalette({
  results,
  selectedIndex,
  onSelect,
  onClose,
}: CommandPaletteProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-command-palette]')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  if (results.length === 0) return null;

  return (
    <div
      data-command-palette
      className="absolute bottom-full left-4 right-4 mb-2 bg-[--bg-overlay] border border-[--border] rounded-xl shadow-2xl overflow-hidden z-50"
    >
      <div className="px-3 py-2 border-b border-[--border]">
        <span className="text-[10px] text-[--text-muted] uppercase tracking-wider font-semibold">
          Commands
        </span>
      </div>
      <ul ref={listRef} className="max-h-56 overflow-y-auto">
        {results.map((cmd, i) => (
          <li key={cmd.id}>
            <button
              className={[
                'w-full text-left px-3 py-2.5 flex items-center gap-3 text-sm transition-colors',
                i === selectedIndex
                  ? 'bg-[--accent] text-white'
                  : 'text-[--text-primary] hover:bg-[--bg-hover]',
              ].join(' ')}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent textarea blur
                onSelect(cmd);
              }}
              onMouseEnter={() => {
                // Handled by parent
              }}
            >
              <code
                className={[
                  'text-xs font-mono px-1.5 py-0.5 rounded',
                  i === selectedIndex
                    ? 'bg-white/20 text-white'
                    : 'bg-[--bg-input] text-[--accent]',
                ].join(' ')}
              >
                {cmd.trigger}
              </code>
              <span
                className={i === selectedIndex ? 'text-white' : 'text-[--text-secondary]'}
              >
                {cmd.description}
              </span>
              {cmd.source === 'mcp' && (
                <span
                  className={[
                    'ml-auto text-[10px] px-1.5 py-0.5 rounded-full',
                    i === selectedIndex
                      ? 'bg-white/20 text-white'
                      : 'bg-[--bg-input] text-[--text-muted]',
                  ].join(' ')}
                >
                  MCP
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="px-3 py-1.5 border-t border-[--border] flex gap-3 text-[10px] text-[--text-muted]">
        <span><kbd className="font-mono">↑↓</kbd> navigate</span>
        <span><kbd className="font-mono">Enter</kbd> select</span>
        <span><kbd className="font-mono">Esc</kbd> close</span>
      </div>
    </div>
  );
}
