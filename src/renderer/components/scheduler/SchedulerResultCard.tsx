import React, { useState } from 'react';
import type { SchedulerRun, MemberStatus, SprintAnalysisOutput } from '../../../shared/types';

const FLAG_ICONS: Record<string, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  warning: '⚠️',
};

const FLAG_LABELS: Record<string, string> = {
  green: 'On track',
  yellow: 'Silent',
  red: 'Blocker',
  warning: 'At risk',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-[--text-muted]',
  running: 'text-yellow-400',
  complete: 'text-green-400',
  failed: 'text-red-400',
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  run: SchedulerRun;
}

export default function SchedulerResultCard({ run }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  let output: SprintAnalysisOutput | null = null;
  if (run.output_json) {
    try {
      output = JSON.parse(run.output_json) as SprintAnalysisOutput;
    } catch {
      // malformed — ignore
    }
  }

  function toggleMember(name: string) {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="border border-[--border] rounded-md overflow-hidden bg-[--bg-base]">
      {/* Header row */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[--bg-hover] transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`text-[10px] font-mono ${STATUS_COLORS[run.status] ?? 'text-[--text-muted]'}`}>
          {run.status === 'running' ? '⟳' : run.status === 'complete' ? '●' : run.status === 'failed' ? '✗' : '○'}
        </span>
        <span className="text-[11px] text-[--text-primary] font-medium flex-1">
          {formatTs(run.triggered_at)}
        </span>
        {run.output_summary && (
          <span className="text-[10px] text-[--text-muted] truncate max-w-[140px]">{run.output_summary}</span>
        )}
        <span className="text-[10px] text-[--text-muted] flex-none">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Error */}
      {run.status === 'failed' && run.error && (
        <div className="px-3 pb-2 text-[10px] text-red-400 font-mono">{run.error}</div>
      )}

      {/* Output */}
      {expanded && output && (
        <div className="border-t border-[--border]">
          {/* Sprint meta */}
          <div className="flex gap-3 px-3 py-2 bg-[--bg-sidebar] border-b border-[--border] text-[10px] text-[--text-muted]">
            <span>Sprint ends: <span className="text-[--text-secondary]">{output.sprint_end}</span></span>
            <span>Days left: <span className="text-[--text-secondary]">{output.days_remaining < 0 ? '—' : output.days_remaining}</span></span>
          </div>

          {/* Member rows */}
          {(output.members as MemberStatus[]).map((m) => (
            <div key={m.name} className="border-b border-[--border] last:border-0">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[--bg-hover] transition-colors text-left"
                onClick={() => toggleMember(m.name)}
              >
                <span title={FLAG_LABELS[m.flag] ?? m.flag}>{FLAG_ICONS[m.flag] ?? '○'}</span>
                <span className="text-[11px] text-[--text-primary] font-medium">{m.name}</span>
                <span className="text-[10px] text-[--text-muted] font-mono">{m.slack_handle}</span>
                <span className="flex-1" />
                <span className="text-[10px] text-[--text-muted]">{expandedMembers.has(m.name) ? '▲' : '▼'}</span>
              </button>

              {expandedMembers.has(m.name) && (
                <div className="px-4 pb-3 space-y-2">
                  <p className="text-[11px] text-[--text-secondary]">{m.summary}</p>
                  <p className="text-[10px] text-[--text-muted] italic">{m.reason}</p>
                  {m.tasks.length > 0 && (
                    <ul className="space-y-0.5">
                      {m.tasks.map((t, i) => (
                        <li key={i} className="text-[10px] text-[--text-secondary] flex gap-1">
                          <span className="text-[--text-muted]">—</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
