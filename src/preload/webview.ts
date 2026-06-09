/// <reference lib="dom" />
import { ipcRenderer } from 'electron';

// ─── Webview preload ──────────────────────────────────────────────────────────
// This script runs inside <webview> elements.
// It exposes only the minimal surface needed for the browser pane integration.

interface PageState {
  url: string;
  title: string;
  selectedText?: string;
}

// ─── Click interception ───────────────────────────────────────────────────────

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const anchor = target.closest('a') as HTMLAnchorElement | null;
  if (!anchor) return;

  const href = anchor.href;
  if (!href) return;

  // Notify the parent frame via sendToHost
  ipcRenderer.sendToHost('webview:linkClick', { href, text: anchor.textContent?.trim() ?? '' });
}, true);

// ─── Page state reporter ──────────────────────────────────────────────────────

function reportPageState(): void {
  const state: PageState = {
    url: window.location.href,
    title: document.title,
    selectedText: window.getSelection()?.toString() ?? '',
  };
  ipcRenderer.sendToHost('webview:pageState', state);
}

// Report on load
window.addEventListener('load', reportPageState);

// Selection changes
document.addEventListener('selectionchange', () => {
  const selected = window.getSelection()?.toString() ?? '';
  if (selected) {
    ipcRenderer.sendToHost('webview:selectionChange', { selectedText: selected });
  }
});

// ─── Exposed API ──────────────────────────────────────────────────────────────

(window as Window & { harnessObserver?: { reportPageState: () => void } }).harnessObserver = {
  reportPageState,
};
