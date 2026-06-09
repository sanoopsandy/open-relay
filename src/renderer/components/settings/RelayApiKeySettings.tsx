import React, { useState } from 'react';
import type { HarnessConfig, TestConnectionResult } from '../../../shared/types';

type EmbeddingProvider = 'openai' | 'ollama';

const PROVIDER_MODELS: Record<HarnessConfig['ai']['provider'], string[]> = {
  claude: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  ollama: ['llama3', 'mistral', 'codellama'],
};

interface Props {
  config: HarnessConfig;
  onUpdated: (config: HarnessConfig) => void;
}

export default function RelayApiKeySettings({ config, onUpdated }: Props) {
  const [provider, setProvider] = useState<HarnessConfig['ai']['provider']>(config.ai.provider);
  const [model, setModel] = useState(config.ai.model);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);

  // Embedding provider state
  const [embProvider, setEmbProvider] = useState<EmbeddingProvider>(
    (config.ai.embeddingProvider as EmbeddingProvider) ?? 'openai'
  );
  const [embKey, setEmbKey] = useState('');
  const [savingEmb, setSavingEmb] = useState(false);
  const [embResult, setEmbResult] = useState<TestConnectionResult | null>(null);
  const hasEmbeddingKey = !!config.ai.embeddingApiKeyCiphertext;

  const models = PROVIDER_MODELS[provider] ?? [];

  async function handleSaveEmbedding() {
    if (!embKey.trim() && embProvider !== 'ollama') return;
    setSavingEmb(true);
    setEmbResult(null);
    try {
      const res = await window.relay.invoke<TestConnectionResult>('settings:updateEmbeddingKey', {
        provider: embProvider,
        plainTextKey: embKey.trim(),
      });
      setEmbResult(res);
      if (res.ok) {
        const updated = await window.relay.invoke<HarnessConfig>('config:load');
        if (updated) onUpdated(updated);
        setEmbKey('');
      }
    } catch (err) {
      setEmbResult({ ok: false, latencyMs: 0, error: String(err) });
    } finally {
      setSavingEmb(false);
    }
  }

  const modelOnlyChange = provider === config.ai.provider && model !== config.ai.model && !apiKey.trim();

  async function handleSaveModel() {
    setSavingModel(true);
    try {
      const updated = await window.relay.invoke<HarnessConfig>('settings:updateModel', { model });
      if (updated) onUpdated(updated);
    } catch (err) {
      setResult({ ok: false, latencyMs: 0, error: String(err) });
    } finally {
      setSavingModel(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await window.relay.invoke<TestConnectionResult>('settings:updateApiKey', {
        provider,
        plainTextKey: apiKey.trim(),
        model,
      });
      setResult(res);
      if (res.ok) {
        const updated = await window.relay.invoke<HarnessConfig>('config:load');
        if (updated) onUpdated(updated);
        setApiKey('');
      }
    } catch (err) {
      setResult({ ok: false, latencyMs: 0, error: String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-[13px] font-semibold text-[--text-primary] mb-1">AI Provider</h2>
        <p className="text-[11px] text-[--text-muted] mb-3">
          Current: <span className="font-medium text-[--text-secondary]">{config.ai.provider}</span> · <span className="font-medium text-[--text-secondary]">{config.ai.model}</span>
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-[--text-muted] mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as HarnessConfig['ai']['provider'];
                setProvider(p);
                setModel(PROVIDER_MODELS[p]?.[0] ?? '');
              }}
              className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] outline-none focus:border-[--accent]"
            >
              {(['claude', 'openai', 'groq', 'gemini', 'ollama'] as const).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[--text-muted] mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] outline-none focus:border-[--accent]"
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[--text-muted] mb-1">
              New API Key {provider === 'ollama' ? '(not required for Ollama)' : ''}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste new key to update…"
              className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
            />
          </div>

          <div className="flex gap-2">
            {modelOnlyChange && (
              <button
                onClick={() => void handleSaveModel()}
                disabled={savingModel}
                className="px-4 py-2 rounded-lg bg-[--accent] text-white text-sm font-medium hover:bg-[--accent-hover] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingModel ? 'Saving…' : 'Save Model'}
              </button>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={saving || (!apiKey.trim() && provider !== 'ollama')}
              className="px-4 py-2 rounded-lg bg-[--accent] text-white text-sm font-medium hover:bg-[--accent-hover] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Testing…' : 'Test & Save'}
            </button>
          </div>

          {result && (
            <div className={[
              'flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]',
              result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
            ].join(' ')}>
              {result.ok
                ? `Connected — ${result.latencyMs}ms`
                : `Failed: ${result.error ?? 'Unknown error'}`}
            </div>
          )}
        </div>
      </div>
      {/* Embeddings */}
      <div className="pt-2 border-t border-[--border]">
        <h2 className="text-[13px] font-semibold text-[--text-primary] mb-1">Embeddings</h2>
        <p className="text-[11px] text-[--text-muted] mb-3">
          Powers semantic memory search and GraphRAG context assembly. Separate from your chat provider.
          {hasEmbeddingKey && <span className="ml-1 text-green-400">✓ Key configured</span>}
        </p>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] text-[--text-muted] mb-1">Provider</label>
              <select
                value={embProvider}
                onChange={(e) => setEmbProvider(e.target.value as EmbeddingProvider)}
                className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] outline-none focus:border-[--accent]"
              >
                <option value="openai">OpenAI (text-embedding-3-small)</option>
                <option value="ollama">Ollama (nomic-embed-text)</option>
              </select>
            </div>
          </div>

          {embProvider !== 'ollama' && (
            <div>
              <label className="block text-[11px] text-[--text-muted] mb-1">API Key</label>
              <input
                type="password"
                value={embKey}
                onChange={(e) => setEmbKey(e.target.value)}
                placeholder={hasEmbeddingKey ? 'Paste new key to update…' : 'Paste OpenAI API key…'}
                className="w-full bg-[--bg-input] border border-[--border] rounded-lg px-3 py-2 text-sm text-[--text-primary] placeholder-[--text-muted] outline-none focus:border-[--accent]"
              />
            </div>
          )}

          <button
            onClick={() => void handleSaveEmbedding()}
            disabled={savingEmb || (!embKey.trim() && embProvider !== 'ollama')}
            className="px-4 py-2 rounded-lg bg-[--accent] text-white text-sm font-medium hover:bg-[--accent-hover] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {savingEmb ? 'Testing…' : 'Test & Save'}
          </button>

          {embResult && (
            <div className={[
              'flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]',
              embResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
            ].join(' ')}>
              {embResult.ok
                ? `Connected — ${embResult.latencyMs}ms`
                : `Failed: ${embResult.error ?? 'Unknown error'}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
