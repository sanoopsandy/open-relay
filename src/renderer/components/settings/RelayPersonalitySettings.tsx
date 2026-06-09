import React, { useState } from 'react';
import type { HarnessConfig } from '../../../shared/types';

interface Props {
  config: HarnessConfig;
  onUpdated: (config: HarnessConfig) => void;
}

export default function RelayPersonalitySettings({ config, onUpdated }: Props) {
  const [prompt, setPrompt] = useState(config.personality?.prompt ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await window.relay.invoke<HarnessConfig>('config:patch', {
        personality: { prompt },
      });
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload() {
    try {
      const content = await window.relay.invoke<string | null>('dialog:openTextFile');
      if (content) setPrompt(content);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h2 className="text-[13px] font-semibold text-[--text-primary] mb-1">Personality</h2>
        <p className="text-[11px] text-[--text-muted]">
          This prompt is appended to the system prompt on every message. Use it to give Relay a consistent voice, style, or working approach.
        </p>
      </div>

      <div className="bg-[--bg-overlay] border border-[--border] rounded-lg px-3 py-2 text-[11px] text-[--text-muted] space-y-1">
        <p className="font-medium text-[--text-secondary]">Examples</p>
        <p>· "You are a terse senior engineer. Skip pleasantries. Use bullet points."</p>
        <p>· "Respond like a friendly product manager. Always end with next steps."</p>
        <p>· "I am a data scientist. Prefer Python examples and statsmodels."</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] text-[--text-muted]">Prompt</label>
          <span className="text-[10px] text-[--text-muted]">{prompt.length} chars</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe how Relay should behave…"
          rows={8}
          className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent] resize-none leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[--accent] text-white text-sm font-medium hover:bg-[--accent-hover] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => void handleUpload()}
          className="px-4 py-2 rounded-lg border border-[--border] text-[--text-secondary] text-sm hover:bg-[--bg-hover] transition-colors"
        >
          Upload .md file
        </button>
        {saved && <span className="text-[11px] text-green-400">Saved</span>}
      </div>
    </div>
  );
}
