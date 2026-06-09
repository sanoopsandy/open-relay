import React, { useEffect, useState } from 'react';
import type { UsageSummary, ConversationUsage, TurnTokenData } from '../../../shared/types';

type DateFilter = 'today' | '7d' | '30d' | 'all';

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtCost(usd: number) {
  if (usd < 0.01) return `${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(4)}`;
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Plateau Chart ────────────────────────────────────────────────────────────

function PlateauChart({ data }: { data: TurnTokenData[] }) {
  if (data.length < 3) return null;

  const W = 500, H = 140;
  const padT = 10, padR = 20, padB = 30, padL = 52;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxTurn = Math.max(...data.map(d => d.turnIndex));
  const maxVal  = Math.max(...data.map(d => d.avgInputTokens));
  const minVal  = Math.min(...data.map(d => d.avgInputTokens));

  const xScale = (t: number) => padL + (maxTurn > 0 ? (t / maxTurn) * innerW : 0);
  const yScale = (v: number) => padT + (maxVal > 0 ? (1 - (v - minVal) / (maxVal - minVal || 1)) * innerH : innerH);

  const points = data.map(d => `${xScale(d.turnIndex)},${yScale(d.avgInputTokens)}`).join(' ');

  // Y ticks — 3 evenly spaced
  const yTicks = [minVal, Math.round((minVal + maxVal) / 2), maxVal];
  // X ticks — every 5th turn, capped at 5 labels
  const step = Math.max(1, Math.ceil(maxTurn / 5));
  const xTicks: number[] = [];
  for (let i = step; i <= maxTurn; i += step) xTicks.push(i);

  function fmtK(n: number) {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  return (
    <div className="bg-[--bg-overlay] border border-[--border] rounded-xl px-4 pt-3 pb-2">
      <p className="text-[11px] font-semibold text-[--text-primary] mb-0.5">Input tokens per turn</p>
      <p className="text-[10px] text-[--text-muted] mb-2">Plateaus as memory replaces full history</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <line key={i}
            x1={padL} y1={yScale(v)} x2={W - padR} y2={yScale(v)}
            stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3"
          />
        ))}
        {/* Y axis labels */}
        {yTicks.map((v, i) => (
          <text key={i}
            x={padL - 6} y={yScale(v) + 4}
            textAnchor="end" fontSize={9} fill="var(--text-muted)"
          >{fmtK(v)}</text>
        ))}
        {/* X axis labels */}
        {xTicks.map((t, i) => (
          <text key={i}
            x={xScale(t)} y={H - 4}
            textAnchor="middle" fontSize={9} fill="var(--text-muted)"
          >{t}</text>
        ))}
        {/* X axis label */}
        <text x={W / 2} y={H} textAnchor="middle" fontSize={9} fill="var(--text-muted)">turn</text>
        {/* Data line */}
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Data dots */}
        {data.map((d, i) => (
          <circle key={i}
            cx={xScale(d.turnIndex)} cy={yScale(d.avgInputTokens)}
            r={2.5} fill="var(--accent)"
          />
        ))}
      </svg>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function dateFilterThreshold(filter: DateFilter): number {
  const now = Date.now();
  if (filter === 'today') return new Date().setHours(0, 0, 0, 0);
  if (filter === '7d') return now - 7 * 24 * 60 * 60 * 1000;
  if (filter === '30d') return now - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

export default function RelayUsageSettings() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [rows, setRows] = useState<ConversationUsage[]>([]);
  const [turnData, setTurnData] = useState<TurnTokenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  useEffect(() => {
    setLoading(true);
    const since = dateFilterThreshold(dateFilter) || undefined;
    Promise.all([
      window.relay.invoke<UsageSummary>('usage:summary', since),
      window.relay.invoke<ConversationUsage[]>('usage:byConversation', since),
      window.relay.invoke<TurnTokenData[]>('usage:tokensByTurn', since),
    ]).then(([s, r, t]) => {
      setSummary(s);
      setRows(r);
      setTurnData(t);
    }).catch(console.error).finally(() => setLoading(false));
  }, [dateFilter]);

  const filteredRows = rows;

  if (loading) return <p className="text-[--text-muted] text-sm">Loading…</p>;
  if (!summary) return null;

  const totalWithSaved = summary.totalInputTokens + summary.contextSavedTokens;
  const savingPct = totalWithSaved > 0
    ? Math.round((summary.contextSavedTokens / totalWithSaved) * 100)
    : 0;
  const savingPctLabel = summary.contextSavedTokens > 0 && savingPct === 0 ? '< 1%' : `↓${savingPct}%`;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Tokens In" value={fmt(summary.totalInputTokens)} />
        <StatCard label="Tokens Out" value={fmt(summary.totalOutputTokens)} />
        <StatCard label="Est. Cost" value={fmtCost(summary.totalCostUsd)} />
      </div>

      {/* Context savings card */}
      {summary.contextSavedTokens > 0 && (
        <div className="bg-[--accent]/10 border border-[--accent]/30 rounded-xl px-4 py-3">
          <p className="text-[12px] font-semibold text-[--accent] mb-2">Relay saved you</p>
          <div className="flex items-baseline gap-6">
            <div>
              <p className="text-[22px] font-bold text-[--text-primary] leading-none">{fmtCost(summary.contextSavedCostUsd)}</p>
              <p className="text-[10px] text-[--text-muted] mt-0.5">in context cost</p>
            </div>
            <div>
              <p className="text-[22px] font-bold text-[--text-primary] leading-none">{savingPctLabel}</p>
              <p className="text-[10px] text-[--text-muted] mt-0.5">fewer tokens</p>
            </div>
            <div>
              <p className="text-[22px] font-bold text-[--text-primary] leading-none">{fmt(summary.contextSavedTokens)}</p>
              <p className="text-[10px] text-[--text-muted] mt-0.5">tokens saved</p>
            </div>
          </div>
          <p className="text-[10px] text-[--text-muted] mt-2">
            Memory context assembly replaced full history sends — {fmt(summary.contextSavedTokens)} fewer input tokens sent
            {summary.memoryGenCount > 0 ? ` across ${summary.memoryGenCount} memory-assisted response${summary.memoryGenCount !== 1 ? 's' : ''}` : ''}.
          </p>
        </div>
      )}

      {/* Plateau chart */}
      <PlateauChart data={turnData} />

      {/* Per-conversation table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[12px] font-semibold text-[--text-primary]">Per Conversation</h3>
          <div className="flex items-center gap-1">
            {(['today', '7d', '30d', 'all'] as DateFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setDateFilter(f)}
                className={[
                  'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
                  dateFilter === f
                    ? 'bg-[--accent] text-white'
                    : 'text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover]',
                ].join(' ')}
              >
                {f === 'all' ? 'All time' : f === 'today' ? 'Today' : f}
              </button>
            ))}
          </div>
        </div>
        {filteredRows.length === 0 ? (
          <p className="text-[11px] text-[--text-muted]">
            {rows.length === 0 ? 'No usage recorded yet — start chatting.' : 'No conversations in this period.'}
          </p>
        ) : (
          <div className="border border-[--border] rounded-xl overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-[--bg-overlay]">
                <tr>
                  {['Conversation', 'Date', 'Tokens In', 'Tokens Out', 'Cost', 'Rounds'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[--text-muted] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[--border]">
                {filteredRows.map((r, i) => (
                  <tr key={i} className="hover:bg-[--bg-hover] transition-colors">
                    <td className="px-3 py-2 text-[--text-primary] max-w-[160px] truncate">{r.conversationTitle}</td>
                    <td className="px-3 py-2 text-[--text-muted] whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2 text-[--text-secondary]">{fmt(r.inputTokens)}</td>
                    <td className="px-3 py-2 text-[--text-secondary]">{fmt(r.outputTokens)}</td>
                    <td className="px-3 py-2 text-[--text-secondary]">{fmtCost(r.costUsd)}</td>
                    <td className="px-3 py-2 text-[--text-muted]">
                      {r.chatRounds} chat{r.memoryGenRounds > 0 ? ` · ${r.memoryGenRounds} mem` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[--bg-overlay] border border-[--border] rounded-xl px-4 py-3">
      <p className="text-[10px] text-[--text-muted] mb-1">{label}</p>
      <p className="text-[16px] font-semibold text-[--text-primary]">{value}</p>
    </div>
  );
}
