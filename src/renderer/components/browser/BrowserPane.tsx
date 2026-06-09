import React from 'react';
import { useLayoutStore } from '../../stores/layoutStore';

export default function BrowserPane() {
  const layout = useLayoutStore();

  return (
    <div className="h-full flex flex-col bg-[--bg-base]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[--border] bg-[--bg-sidebar]">
        <span className="flex-1 text-sm text-[--text-muted] font-medium">Browser</span>
        <button
          onClick={() => layout.setBrowserPane('hidden')}
          className="p-1 rounded text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors"
          title="Close browser pane"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Placeholder content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-[--bg-input] flex items-center justify-center">
          <svg className="w-8 h-8 text-[--text-muted]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </div>
        <div>
          <p className="text-[--text-primary] font-medium">Browser Pane</p>
          <p className="text-[--text-muted] text-sm mt-1 max-w-xs">
            Browser integration is coming in Week 2. You'll be able to browse websites,
            extract content, and have the agent act on web pages.
          </p>
        </div>
        <button
          onClick={() => layout.setBrowserPane('hidden')}
          className="px-4 py-2 rounded-lg text-sm bg-[--bg-input] text-[--text-secondary] hover:bg-[--bg-hover] hover:text-[--text-primary] transition-colors"
        >
          Close pane
        </button>
      </div>
    </div>
  );
}
