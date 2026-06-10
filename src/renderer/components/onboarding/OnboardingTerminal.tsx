import React, { useState, useRef, useEffect } from 'react';
import type { HarnessConfig } from '../../../shared/types';

interface OnboardingTerminalProps {
  onComplete: (config: HarnessConfig) => void;
}

type Step =
  | 'welcome'
  | 'select_provider'
  | 'enter_key'
  | 'validating'
  | 'select_model'
  | 'embedding'
  | 'summary'
  | 'personality'
  | 'connect_services'
  | 'enter_slack_team'
  | 'enter_slack_token'
  | 'done';

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Anthropic Claude',
  openai: 'OpenAI',
  groq: 'Groq (fast & free)',
  ollama: 'Ollama (local)',
  gemini: 'Google Gemini',
};

const PROVIDER_MODELS: Record<string, string[]> = {
  claude: ['claude-opus-4-8', 'claude-fable-5', 'claude-opus-4-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  ollama: [],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
};

const DEFAULT_MODELS: Record<string, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  groq: 'llama-3.1-70b-versatile',
  ollama: 'llama3.2',
  gemini: 'gemini-1.5-flash',
};

interface LogEntry {
  type: 'output' | 'input' | 'success' | 'error' | 'muted';
  text: string;
}

export default function OnboardingTerminal({ onComplete }: OnboardingTerminalProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [provider, setProvider] = useState<HarnessConfig['ai']['provider']>('claude');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [providerIndex, setProviderIndex] = useState(0);
  const [slackTeamId, setSlackTeamId] = useState('');
  const [slackToken, setSlackToken] = useState('');
  const [personalityPrompt, setPersonalityPrompt] = useState('');
  const [connectorIndex, setConnectorIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const providers = Object.keys(PROVIDER_LABELS) as HarnessConfig['ai']['provider'][];

  function appendLog(entry: LogEntry) {
    setLog((prev) => [...prev, entry]);
  }

  function print(text: string, type: LogEntry['type'] = 'output') {
    appendLog({ type, text });
  }

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [log]);

  // Welcome step
  useEffect(() => {
    if (step === 'welcome') {
      setTimeout(() => {
        print('');
        print('  ██████╗ ███████╗██╗      █████╗ ██╗   ██╗', 'muted');
        print('  ██╔══██╗██╔════╝██║     ██╔══██╗╚██╗ ██╔╝', 'muted');
        print('  ██████╔╝█████╗  ██║     ███████║ ╚████╔╝ ', 'muted');
        print('  ██╔══██╗██╔══╝  ██║     ██╔══██║  ╚██╔╝  ', 'muted');
        print('  ██║  ██║███████╗███████╗██║  ██║   ██║   ', 'muted');
        print('  ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝   ', 'muted');
        print('');
        print('  Your AI workspace with memory  v0.1.0', 'muted');
        print('');
        print('Welcome! Let\'s get you set up in about 30 seconds.');
        print('');
        setTimeout(() => setStep('select_provider'), 600);
      }, 200);
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Select provider step
  useEffect(() => {
    if (step === 'select_provider') {
      print('─────────────────────────────────────────', 'muted');
      print('Step 1/3: Choose your AI provider');
      print('');
      providers.forEach((p, i) => {
        print(`  [${i + 1}] ${PROVIDER_LABELS[p]}`, i === 0 ? 'success' : 'output');
      });
      print('');
      print('  Use ↑↓ arrows to select, Enter to confirm', 'muted');
      inputRef.current?.focus();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter key step
  useEffect(() => {
    if (step === 'enter_key') {
      print('');
      print('─────────────────────────────────────────', 'muted');
      if (provider === 'ollama') {
        print('Step 2/3: Checking Ollama connection…');
        checkOllama();
      } else {
        print(`Step 2/3: Enter your ${PROVIDER_LABELS[provider]} API key`);
        print('  Your key is encrypted and stored locally.', 'muted');
        print('  It never leaves your machine.', 'muted');
        print('');
        inputRef.current?.focus();
      }
    }
  }, [step, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkOllama() {
    setIsLoading(true);
    try {
      const models = await window.relay.invoke<string[]>('onboarding:listOllamaModels');
      setOllamaModels(models);
      if (models.length === 0) {
        print('  No models found. Install one with:', 'error');
        print('    ollama pull llama3.2', 'muted');
        print('');
        print('  Then press Enter to retry.', 'muted');
        setIsLoading(false);
        return;
      }
      print(`  Found ${models.length} model(s): ${models.slice(0, 3).join(', ')}${models.length > 3 ? '…' : ''}`, 'success');
      PROVIDER_MODELS.ollama = models;
      setModel(models[0]);
      setStep('select_model');
    } catch {
      print('  Could not connect to Ollama at http://localhost:11434', 'error');
      print('  Is Ollama running? Start it with: ollama serve', 'muted');
      print('');
      print('  Press Enter to retry.', 'muted');
    }
    setIsLoading(false);
  }

  // Select model step
  useEffect(() => {
    if (step === 'select_model') {
      const models = PROVIDER_MODELS[provider] ?? [];
      if (models.length === 0) {
        setModel(DEFAULT_MODELS[provider] ?? '');
        setStep('summary');
        return;
      }
      print('');
      print('─────────────────────────────────────────', 'muted');
      print(`Step 3/3: Choose a model`);
      print('');
      models.forEach((m, i) => {
        print(`  [${i + 1}] ${m}`, i === 0 ? 'success' : 'output');
      });
      print('');
      print('  Use ↑↓ arrows or type a number, Enter to confirm', 'muted');
      setModel(models[0]);
      inputRef.current?.focus();
    }
  }, [step, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Summary step
  useEffect(() => {
    if (step === 'summary') {
      print('');
      print('─────────────────────────────────────────', 'muted');
      print('Configuration summary:');
      print('');
      print(`  Provider : ${PROVIDER_LABELS[provider]}`, 'success');
      print(`  Model    : ${model}`, 'success');
      print(`  Key      : ${provider === 'ollama' ? 'n/a (local)' : apiKey ? '••••' + apiKey.slice(-4) : 'none'}`, 'success');
      print('');
      print('Press Enter to continue.', 'muted');
      inputRef.current?.focus();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Personality step
  useEffect(() => {
    if (step === 'personality') {
      print('');
      print('─────────────────────────────────────────', 'muted');
      print('Optional: Give Relay a personality');
      print('');
      print('  Describe how Relay should respond — tone, style, expertise.', 'muted');
      print('  Example: "You are a terse senior engineer. Skip pleasantries."', 'muted');
      print('  Example: "I\'m a PM. Prefer bullet points and action items."', 'muted');
      print('');
      print('  Press Enter to skip, or type your prompt below:', 'muted');
      inputRef.current?.focus();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect services step
  useEffect(() => {
    if (step === 'connect_services') {
      print('');
      print('─────────────────────────────────────────', 'muted');
      print('Step 4/4: Connect services (optional)');
      print('');
      print('  [1] Skip for now', connectorIndex === 0 ? 'success' : 'output');
      print('  [2] Connect Slack (for team scheduler)', connectorIndex === 1 ? 'success' : 'output');
      print('');
      print('  ↑↓ to select, Enter to confirm', 'muted');
      inputRef.current?.focus();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step === 'enter_slack_team') {
      print('');
      print('Enter your Slack Team ID (workspace ID):');
      print('  Found in: Slack → Settings → Workspace details', 'muted');
      print('  Format: T01234ABCDE', 'muted');
      print('');
      inputRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (step === 'enter_slack_token') {
      print('');
      print('Enter your Slack bot token:');
      print('  Create a bot at https://api.slack.com/apps', 'muted');
      print('  Required scopes: channels:read, channels:history, users:read', 'muted');
      print('  Token starts with: xoxb-', 'muted');
      print('');
      inputRef.current?.focus();
    }
  }, [step]);

  async function handleEnter() {
    if (isLoading) return;

    if (step === 'select_provider') {
      const selected = providers[providerIndex];
      print(`> ${PROVIDER_LABELS[selected]}`, 'input');
      setProvider(selected);
      setStep('enter_key');
      return;
    }

    if (step === 'enter_key') {
      if (provider === 'ollama') {
        await checkOllama();
        return;
      }
      const key = inputValue.trim();
      if (!key) {
        print('  Please enter your API key.', 'error');
        return;
      }
      print(`> ${'•'.repeat(Math.min(key.length, 12))}`, 'input');
      setApiKey(key);
      setInputValue('');
      setStep('validating');

      // Validate
      setIsLoading(true);
      print('  Validating key…', 'muted');
      try {
        const result = await window.relay.invoke<{ ok: boolean; latencyMs: number; error?: string }>(
          'onboarding:validateKey',
          provider,
          key
        );
        if (result.ok) {
          print(`  Connected in ${result.latencyMs}ms`, 'success');
          const models = PROVIDER_MODELS[provider] ?? [];
          setModel(models[0] ?? DEFAULT_MODELS[provider]);
          setStep('select_model');
        } else {
          print(`  Connection failed: ${result.error ?? 'unknown error'}`, 'error');
          print('  Please check your API key and try again.', 'muted');
          setInputValue('');
          setStep('enter_key');
        }
      } catch (err) {
        print(`  Error: ${err instanceof Error ? err.message : String(err)}`, 'error');
        setInputValue('');
        setStep('enter_key');
      }
      setIsLoading(false);
      return;
    }

    if (step === 'select_model') {
      const models = PROVIDER_MODELS[provider] ?? [];
      const idx = parseInt(inputValue.trim()) - 1;
      const selectedModel = isNaN(idx) ? models[0] : models[idx] ?? models[0];
      print(`> ${selectedModel}`, 'input');
      setModel(selectedModel);
      setInputValue('');
      setStep('summary');
      return;
    }

    if (step === 'summary') {
      setStep('personality');
      return;
    }

    if (step === 'personality') {
      const prompt = inputValue.trim();
      if (prompt) {
        print(`> ${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}`, 'input');
        setPersonalityPrompt(prompt);
      } else {
        print('> (skipped)', 'muted');
      }
      setInputValue('');
      setStep('connect_services');
      return;
    }

    if (step === 'connect_services') {
      if (connectorIndex === 1) {
        print(`> Connect Slack`, 'input');
        setStep('enter_slack_team');
      } else {
        print('> Skip for now', 'input');
        await completeOnboarding();
      }
      return;
    }

    if (step === 'enter_slack_team') {
      const teamId = inputValue.trim();
      if (!teamId) {
        print('  Please enter your Slack Team ID.', 'error');
        return;
      }
      print(`> ${teamId}`, 'input');
      setSlackTeamId(teamId);
      setInputValue('');
      setStep('enter_slack_token');
      return;
    }

    if (step === 'enter_slack_token') {
      const token = inputValue.trim();
      if (!token) {
        print('  Please enter your bot token.', 'error');
        return;
      }
      print(`> ${'•'.repeat(Math.min(token.length, 12))}`, 'input');
      setSlackToken(token);
      setInputValue('');
      await completeOnboarding({ slack: { teamId: slackTeamId, botToken: token } });
      return;
    }
  }

  async function completeOnboarding(connectors?: {
    slack?: { teamId: string; botToken: string };
  }) {
    setIsLoading(true);
    print('  Saving configuration…', 'muted');
    try {
      const config = await window.relay.invoke<HarnessConfig>(
        'onboarding:complete',
        { provider, apiKey, model, connectors, personalityPrompt: personalityPrompt || undefined }
      );
      print('  Done! Launching Relay…', 'success');
      setStep('done');
      setTimeout(() => onComplete(config), 800);
    } catch (err) {
      print(`  Error: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    setIsLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEnter();
      return;
    }

    if (step === 'select_provider') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setProviderIndex((i) => (i + 1) % providers.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setProviderIndex((i) => (i - 1 + providers.length) % providers.length);
      }
    }

    if (step === 'connect_services') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setConnectorIndex((i) => (i + 1) % 2);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setConnectorIndex((i) => (i - 1 + 2) % 2);
      }
    }

    if (step === 'select_model') {
      const models = PROVIDER_MODELS[provider] ?? [];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = models.indexOf(model);
        const next = models[(cur + 1) % models.length];
        if (next) setModel(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = models.indexOf(model);
        const prev = models[(cur - 1 + models.length) % models.length];
        if (prev) setModel(prev);
      }
    }
  }

  const showInput = step === 'enter_key' || step === 'select_model' || step === 'summary' || step === 'select_provider' || step === 'connect_services' || step === 'enter_slack_team' || step === 'enter_slack_token' || step === 'personality';
  const isPassword = (step === 'enter_key' && provider !== 'ollama') || step === 'enter_slack_token';

  return (
    <div className="h-screen w-screen bg-[#0a0a0a] flex flex-col font-mono text-sm overflow-hidden">
      {/* Title bar drag region */}
      <div className="h-10 drag-region flex-none" />

      {/* Terminal output */}
      <div className="flex-1 overflow-y-auto px-8 pb-4 space-y-0.5">
        {log.map((entry, i) => (
          <div key={i} className={logClass(entry.type)}>
            {entry.type === 'input' && (
              <span className="text-green-500 mr-2">›</span>
            )}
            {entry.text}
          </div>
        ))}

        {/* Provider selection visual */}
        {step === 'select_provider' && (
          <div className="mt-2 space-y-0.5">
            {providers.map((p, i) => (
              <div
                key={p}
                className={[
                  'px-2 py-1 rounded cursor-pointer transition-colors',
                  i === providerIndex
                    ? 'bg-green-500/20 text-green-400'
                    : 'text-neutral-400',
                ].join(' ')}
                onClick={() => {
                  setProviderIndex(i);
                }}
                onDoubleClick={() => {
                  setProviderIndex(i);
                  handleEnter();
                }}
              >
                {i === providerIndex ? '▶ ' : '  '}{PROVIDER_LABELS[p]}
              </div>
            ))}
          </div>
        )}

        {/* Connector selection visual */}
        {step === 'connect_services' && (
          <div className="mt-2 space-y-0.5">
            {['Skip for now', 'Connect Slack'].map((label, i) => (
              <div
                key={i}
                className={[
                  'px-2 py-1 rounded cursor-pointer transition-colors',
                  i === connectorIndex ? 'bg-green-500/20 text-green-400' : 'text-neutral-400',
                ].join(' ')}
                onClick={() => setConnectorIndex(i)}
                onDoubleClick={() => { setConnectorIndex(i); void handleEnter(); }}
              >
                {i === connectorIndex ? '▶ ' : '  '}{label}
              </div>
            ))}
          </div>
        )}

        {/* Model selection visual */}
        {step === 'select_model' && (
          <div className="mt-2 space-y-0.5">
            {(PROVIDER_MODELS[provider] ?? []).map((m) => (
              <div
                key={m}
                className={[
                  'px-2 py-1 rounded cursor-pointer transition-colors',
                  m === model ? 'bg-green-500/20 text-green-400' : 'text-neutral-400',
                ].join(' ')}
                onClick={() => setModel(m)}
                onDoubleClick={() => {
                  setModel(m);
                  setTimeout(handleEnter, 50);
                }}
              >
                {m === model ? '▶ ' : '  '}{m}
              </div>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input line */}
      {showInput && (
        <div className="flex-none px-8 pb-8 pt-2 border-t border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="text-green-500">›</span>
            <input
              ref={inputRef}
              type={isPassword ? 'password' : 'text'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={
                step === 'select_provider'
                  ? 'Press Enter to select'
                  : step === 'enter_key' && provider !== 'ollama'
                  ? 'sk-…  (paste your API key)'
                  : step === 'select_model'
                  ? 'Press Enter to confirm'
                  : step === 'summary'
                  ? 'Press Enter to continue'
                  : step === 'connect_services'
                  ? 'Press Enter to select'
                  : step === 'enter_slack_team'
                  ? 'T01234ABCDE'
                  : step === 'enter_slack_token'
                  ? 'xoxb-...'
                  : step === 'personality'
                  ? 'Describe your personality… (or press Enter to skip)'
                  : 'Press Enter to save and launch'
              }
              autoFocus
              className="flex-1 bg-transparent text-green-300 placeholder-neutral-600 outline-none caret-green-400"
            />
            {isLoading && (
              <span className="w-4 h-4 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function logClass(type: LogEntry['type']): string {
  switch (type) {
    case 'input':   return 'text-green-300';
    case 'success': return 'text-green-400';
    case 'error':   return 'text-red-400';
    case 'muted':   return 'text-neutral-600';
    default:        return 'text-neutral-300';
  }
}
