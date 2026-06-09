import React, { useEffect } from 'react';
import type { HarnessConfig, LayoutState } from '../../../shared/types';
import { useLayoutStore } from '../../stores/layoutStore';
import Sidebar from './Sidebar';
import ChatPanel from '../chat/ChatPanel';
import MemoryPane from '../memory/MemoryPane';
import ArtifactPane from '../artifacts/ArtifactPane';
import LogViewer from '../logs/LogViewer';
import SchedulerView from '../scheduler/SchedulerView';
import RelaySettingsView from '../settings/RelaySettingsView';
import { useStream } from '../../hooks/useStream';
import { useLogStream } from '../../hooks/useLogStream';

interface PanelLayoutProps {
  config: HarnessConfig;
}

export default function PanelLayout({ config }: PanelLayoutProps) {
  const layout = useLayoutStore();

  useStream();
  useLogStream();

  // Sync layout from main process events (e.g., slash commands)
  useEffect(() => {
    const unsub = window.relay.on('layout:changed', (payload) => {
      layout.applyPatch(payload as Partial<LayoutState>, { persist: false });
    });

    const unsubCmd = window.relay.on('layout:command', (payload) => {
      const { action } = payload as { action: string };
      switch (action) {
        case 'toggleMemory': layout.toggleMemoryPane(); break;
        case 'openMemory': layout.setMemoryPaneOpen(true); break;
        case 'toggleLogs': layout.toggleLogViewer(); break;
        case 'toggleSidebar': layout.toggleSidebar(); break;
        default: break;
      }
    });

    return () => {
      unsub();
      unsubCmd();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply config layout on mount
  useEffect(() => {
    layout.applyPatch(
      {
        sidebarOpen: config.layout.sidebarOpen,
        memoryPaneOpen: config.layout.memoryPaneOpen ?? false,
      },
      { persist: false }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dataLayout = [
    layout.sidebarOpen ? 'sidebar' : '',
    layout.memoryPaneOpen ? 'memory' : '',
    layout.logViewerOpen ? 'logs' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="harness-layout h-screen w-screen flex overflow-hidden bg-[--bg-base] text-[--text-primary]"
      data-layout={dataLayout}
    >
      {/* Sidebar */}
      <div
        className={[
          'sidebar-panel flex-none transition-all duration-200',
          layout.sidebarOpen ? 'w-56' : 'w-0 overflow-hidden',
        ].join(' ')}
      >
        {layout.sidebarOpen && <Sidebar config={config} />}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {layout.activeView === 'settings' ? (
          <RelaySettingsView />
        ) : layout.activeView === 'scheduler' ? (
          <SchedulerView />
        ) : (
          <>
            {/* Chat + Memory split */}
            <div className="flex-1 flex min-h-0">
              {/* Chat panel */}
              <div
                className={[
                  'flex-1 flex flex-col min-w-0',
                  layout.memoryPaneOpen ? 'border-r border-[--border]' : '',
                ].join(' ')}
              >
                <ChatPanel config={config} />
              </div>

              {/* Right panel slot — memory or artifact, mutually exclusive */}
              {(layout.memoryPaneOpen || layout.artifactPaneOpen) && (
                <div className="flex-none w-[440px] border-l border-neutral-800">
                  {layout.memoryPaneOpen ? <MemoryPane /> : <ArtifactPane />}
                </div>
              )}
            </div>

            {/* Log viewer */}
            {layout.logViewerOpen && (
              <div className="flex-none h-56 border-t border-[--border]">
                <LogViewer />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
