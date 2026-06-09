import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { SlashCommand, Attachment } from '../../../shared/types';
import { useSlashCommand } from '../../hooks/useSlashCommand';
import CommandPalette from './CommandPalette';
import { useChatStore } from '../../stores/chatStore';

interface MessageComposerProps {
  onSend: (message: string, attachmentPaths?: string[]) => void;
  disabled?: boolean;
  conversationId?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MessageComposer({ onSend, disabled = false, conversationId }: MessageComposerProps) {
  const messages = useChatStore(s => s.messages);
  const storageKey = `harness:draft:${conversationId ?? 'default'}`;

  const [value, setValue] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Restore draft when switching conversations or after sleep/wake remount
  useEffect(() => {
    const saved = localStorage.getItem(storageKey) ?? '';
    setValue(saved);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      if (saved) textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [storageKey]);

  const setDraft = useCallback((v: string) => {
    setValue(v);
    if (v) localStorage.setItem(storageKey, v);
    else localStorage.removeItem(storageKey);
  }, [storageKey]);
  const [cmdProcessing, setCmdProcessing] = useState(false);
  const [cmdLabel, setCmdLabel] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCommandSelect = useCallback(
    async (command: SlashCommand, args: string, prefixContext: string) => {
      setDraft('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';

      if (command.id === 'add-to-memory') {
        // Route through chat so user message + AI response are both persisted
        const fullMessage = prefixContext
          ? `${prefixContext} ${command.trigger} ${args}`.trim()
          : `${command.trigger} ${args}`.trim();
        onSend(fullMessage);
        return;
      }

      const mergedArgs = prefixContext ? `${args} ${prefixContext}`.trim() : args;
      const label = 'Processing…';
      setCmdLabel(label);
      setCmdProcessing(true);
      try {
        await window.relay.invoke('commands:dispatch', command.id, mergedArgs, conversationId);
      } catch (err) {
        console.error('Command dispatch failed:', err);
      } finally {
        setCmdProcessing(false);
        setCmdLabel('');
        textareaRef.current?.focus();
      }
    },
    [conversationId, onSend, setDraft]
  );

  const handleAutocomplete = useCallback((text: string) => {
    setDraft(text);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
      textareaRef.current.focus();
    }
  }, [setDraft]);

  const { isOpen: paletteOpen, results, selectedIndex, handleKeyDown, selectCommand, close } =
    useSlashCommand(value, handleCommandSelect, handleAutocomplete);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  function handleKeyDownWrapper(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const consumed = handleKeyDown(e);
    if (consumed) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function pickFile() {
    try {
      const attachment = await window.relay.invoke<Attachment | null>('dialog:openFile');
      if (attachment) {
        setAttachments((prev) => {
          if (prev.some((a) => a.filePath === attachment.filePath)) return prev;
          return [...prev, attachment];
        });
      }
    } catch (err) {
      console.error('File picker failed:', err);
    }
  }

  function removeAttachment(filePath: string) {
    setAttachments((prev) => prev.filter((a) => a.filePath !== filePath));
  }

  async function submit() {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled || cmdProcessing) return;

    // Detect "/" at word boundary anywhere in the input (start or after whitespace)
    const lastSlashIdx = (() => {
      const idx = trimmed.lastIndexOf('/');
      if (idx === -1) return -1;
      if (idx === 0 || /\s/.test(trimmed[idx - 1])) return idx;
      return -1;
    })();

    if (lastSlashIdx >= 0) {
      const slashPart = trimmed.slice(lastSlashIdx);
      const prefixPart = trimmed.slice(0, lastSlashIdx).trim();
      try {
        const resolved = await window.relay.invoke<{ commandId: string; args: string } | null>(
          'commands:resolve',
          slashPart
        );
        if (resolved) {
          if (resolved.commandId === 'add-to-memory') {
            // Route through chat for persistence and proper streaming UX
            setDraft('');
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            onSend(trimmed);
            return;
          }

          const mergedArgs = prefixPart ? `${resolved.args} ${prefixPart}`.trim() : resolved.args;
          setCmdLabel('Processing…');
          setCmdProcessing(true);
          setDraft('');
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
          try {
            await window.relay.invoke('commands:dispatch', resolved.commandId, mergedArgs, conversationId);
          } finally {
            setCmdProcessing(false);
            setCmdLabel('');
            textareaRef.current?.focus();
          }
          return;
        }
      } catch (err) {
        console.error('Slash command failed:', err);
        setCmdProcessing(false);
        setCmdLabel('');
      }
    }

    const paths = attachments.map((a) => a.filePath);
    onSend(trimmed, paths.length > 0 ? paths : undefined);
    setDraft('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  return (
    <div className="relative px-4 pb-4 pt-2">
      {paletteOpen && (
        <CommandPalette
          results={results}
          selectedIndex={selectedIndex}
          onSelect={selectCommand}
          onClose={close}
        />
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a) =>
            a.mimeType.startsWith('image/') ? (
              <div key={a.filePath} className="relative group">
                <img
                  src={`file://${a.filePath}`}
                  alt={a.name}
                  className="h-20 w-20 object-cover rounded-xl border border-[--border]"
                />
                <div className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => removeAttachment(a.filePath)}
                    className="text-white text-xs font-semibold"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
                <span className="absolute bottom-0 left-0 right-0 text-[9px] text-white bg-black/50 text-center rounded-b-xl truncate px-1 py-0.5 leading-tight">
                  {a.name}
                </span>
              </div>
            ) : (
              <div
                key={a.filePath}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[--bg-input] border border-[--border] text-[11px] text-[--text-secondary]"
              >
                <svg className="w-3 h-3 text-[--text-muted] flex-none" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.5 1H4a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V5.5L9.5 1z" opacity=".4"/>
                  <path d="M9 1v4a1 1 0 001 1h4"/>
                </svg>
                <span className="max-w-[140px] truncate">{a.name}</span>
                <span className="text-[--text-muted]">{formatSize(a.size)}</span>
                <button
                  onClick={() => removeAttachment(a.filePath)}
                  className="text-[--text-muted] hover:text-[--text-primary] transition-colors ml-0.5"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* Input area */}
      <div
        className={[
          'flex items-end gap-2 px-3 py-2 rounded-xl transition-colors',
          disabled || cmdProcessing
            ? 'bg-[--bg-input] opacity-60'
            : 'bg-[--bg-input]',
        ].join(' ')}
      >
        {/* Attach file button */}
        <button
          onClick={() => void pickFile()}
          disabled={disabled || cmdProcessing}
          className="flex-none mb-0.5 w-7 h-7 flex items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary] hover:bg-[--bg-hover] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Attach file"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDownWrapper}
          disabled={disabled || cmdProcessing}
          placeholder={cmdProcessing ? cmdLabel : disabled ? 'Thinking…' : 'Message Relay (/ for commands)'}
          rows={1}
          className="flex-1 bg-transparent text-[--text-primary] placeholder-[--text-muted] text-sm resize-none outline-none leading-relaxed min-h-[1.5rem] max-h-[200px]"
        />

        <button
          onClick={submit}
          disabled={disabled || cmdProcessing || (!value.trim() && attachments.length === 0)}
          className={[
            'flex-none w-7 h-7 rounded-lg flex items-center justify-center transition-colors mb-0.5',
            disabled || cmdProcessing || (!value.trim() && attachments.length === 0)
              ? 'bg-[--bg-hover] text-[--text-muted] cursor-not-allowed'
              : 'bg-[--accent] text-white hover:bg-[--accent-hover] cursor-pointer',
          ].join(' ')}
          title="Send (Enter)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m-7-7l7 7-7 7" />
          </svg>
        </button>
      </div>

      <TokenMeter messages={messages} />
    </div>
  );
}

function TokenMeter({ messages }: { messages: ReturnType<typeof useChatStore.getState>['messages'] }) {
  const chatMessages = messages.filter(m => m.role !== 'system');
  if (chatMessages.length < 6) return (
    <p className="text-[10px] text-[--text-muted] text-center mt-1.5">
      Enter to send · Shift+Enter for newline · / for commands
    </p>
  );

  const fullTokens   = chatMessages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
  const windowTokens = chatMessages.slice(-4).reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
  const savingPct    = fullTokens > 0 ? Math.round((1 - windowTokens / fullTokens) * 100) : 0;

  return (
    <div className="flex items-center justify-between mt-1.5 px-0.5">
      <p className="text-[10px] text-[--text-muted]">
        Enter to send · Shift+Enter for newline · / for commands
      </p>
      {savingPct > 0 && (
        <p className="text-[10px] text-[--text-muted]">
          ~{windowTokens.toLocaleString()} tokens · <span className="text-[--accent]">↓{savingPct}%</span> vs full history
        </p>
      )}
    </div>
  );
}
