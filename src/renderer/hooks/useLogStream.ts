import { useEffect } from 'react';
import type { LogLine } from '../../shared/types';
import { useLogStore } from '../stores/logStore';

/**
 * Start main-process log streaming and mirror lines into logStore.
 * Mount once at app level so logs accumulate before the log panel opens.
 */
export function useLogStream(): void {
  const appendLine = useLogStore((s) => s.appendLine);
  const setStreaming = useLogStore((s) => s.setStreaming);

  useEffect(() => {
    let cancelled = false;

    void window.relay.invoke('logs:startStreaming').then(() => {
      if (!cancelled) setStreaming(true);
    });

    const unsub = window.relay.on('logs:line', (payload) => {
      appendLine(payload as LogLine);
    });

    return () => {
      cancelled = true;
      unsub();
      void window.relay.invoke('logs:stopStreaming');
      setStreaming(false);
    };
  }, [appendLine, setStreaming]);
}
