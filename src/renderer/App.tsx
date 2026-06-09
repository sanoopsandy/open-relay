import React, { useEffect, useState } from 'react';
import type { HarnessConfig } from '../shared/types';
import MainLayout from './components/layout/PanelLayout';
import OnboardingTerminal from './components/onboarding/OnboardingTerminal';

type AppState = 'loading' | 'onboarding' | 'ready';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [config, setConfig] = useState<HarnessConfig | null>(null);

  useEffect(() => {
    return window.relay.on('config:updated', (updated) => {
      setConfig(updated as HarnessConfig);
    });
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const loaded = await window.relay.invoke<HarnessConfig | null>('config:load');
        if (loaded) {
          setConfig(loaded);
          setAppState('ready');
        } else {
          setAppState('onboarding');
        }
      } catch (err) {
        console.error('Failed to load config:', err);
        setAppState('onboarding');
      }
    }
    init();
  }, []);

  function handleOnboardingComplete(completedConfig: HarnessConfig) {
    setConfig(completedConfig);
    setAppState('ready');
  }

  if (appState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
          <span className="text-sm text-neutral-500 font-mono">Loading Harness…</span>
        </div>
      </div>
    );
  }

  if (appState === 'onboarding') {
    return <OnboardingTerminal onComplete={handleOnboardingComplete} />;
  }

  return <MainLayout config={config!} />;
}
