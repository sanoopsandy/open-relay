import React, { useEffect, useState } from 'react';
import type { HarnessConfig } from '../../../shared/types';
import RelayApiKeySettings from './RelayApiKeySettings';
import RelayConnectorsSettings from './RelayConnectorsSettings';
import RelayPersonalitySettings from './RelayPersonalitySettings';
import RelayUsageSettings from './RelayUsageSettings';

type Tab = 'ai' | 'connectors' | 'personality' | 'usage';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'personality', label: 'Personality' },
  { id: 'usage', label: 'Usage' },
];

export default function RelaySettingsView() {
  const [tab, setTab] = useState<Tab>('ai');
  const [config, setConfig] = useState<HarnessConfig | null>(null);

  useEffect(() => {
    window.relay.invoke<HarnessConfig | null>('config:load').then(setConfig).catch(console.error);
  }, []);

  function onConfigUpdated(updated: HarnessConfig) {
    setConfig(updated);
  }

  return (
    <div className="h-full flex flex-col bg-[--bg-base] overflow-hidden">
      {/* Header */}
      <div className="flex-none px-8 pt-10 pb-0 border-b border-[--border]">
        <h1 className="text-lg font-semibold text-[--text-primary] mb-4">Settings</h1>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'px-4 py-1.5 rounded-t-md text-sm font-medium transition-colors border-b-2',
                tab === t.id
                  ? 'border-[--accent] text-[--text-primary] bg-[--bg-overlay]'
                  : 'border-transparent text-[--text-secondary] hover:text-[--text-primary] hover:bg-[--bg-hover]',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {config === null ? (
          <p className="text-[--text-muted] text-sm">Loading…</p>
        ) : (
          <>
            {tab === 'ai' && <RelayApiKeySettings config={config} onUpdated={onConfigUpdated} />}
            {tab === 'connectors' && <RelayConnectorsSettings config={config} onUpdated={onConfigUpdated} />}
            {tab === 'personality' && <RelayPersonalitySettings config={config} onUpdated={onConfigUpdated} />}
            {tab === 'usage' && <RelayUsageSettings />}
          </>
        )}
      </div>
    </div>
  );
}
