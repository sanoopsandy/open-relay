import { useCallback, useEffect, useMemo } from 'react';
import { useCommandStore } from '../stores/commandStore';
import type { SlashCommand } from '../../shared/types';

/**
 * Hook that provides slash command detection and palette control.
 * Detects "/" at start of input OR after whitespace, so users can type
 * context first then append a slash command inline.
 */
export function useSlashCommand(
  value: string,
  onCommandSelect: (command: SlashCommand, args: string, prefixContext: string) => void,
  onAutocomplete: (text: string) => void
) {
  const commandStore = useCommandStore();

  // Find the last "/" that sits at a word boundary (position 0 or preceded by whitespace)
  const { slashIndex, prefixPart, slashQuery } = useMemo(() => {
    const idx = value.lastIndexOf('/');
    if (idx === -1 || (idx > 0 && !/\s/.test(value[idx - 1]))) {
      return { slashIndex: -1, prefixPart: '', slashQuery: '' };
    }
    return {
      slashIndex: idx,
      prefixPart: value.slice(0, idx).trim(),
      slashQuery: value.slice(idx + 1),
    };
  }, [value]);

  useEffect(() => {
    if (slashIndex === -1) {
      if (commandStore.isOpen) commandStore.close();
      return;
    }

    window.relay
      .invoke<SlashCommand[]>('commands:search', slashQuery)
      .then((results) => {
        commandStore.setResults(results);
        if (!commandStore.isOpen) {
          commandStore.open(slashQuery);
        } else {
          commandStore.setQuery(slashQuery);
        }
      })
      .catch(console.error);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!commandStore.isOpen) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        commandStore.selectNext();
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        commandStore.selectPrev();
        return true;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const selected = commandStore.getSelected();
        if (selected) {
          commandStore.close();
          const newValue = prefixPart
            ? `${prefixPart} ${selected.trigger} `
            : `${selected.trigger} `;
          onAutocomplete(newValue);
        }
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const selected = commandStore.getSelected();
        if (!selected) return false;
        e.preventDefault();
        const slashPart = value.slice(slashIndex);
        const args = slashPart.slice(selected.trigger.length).trim();
        commandStore.close();
        onCommandSelect(selected, args, prefixPart);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        commandStore.close();
        return true;
      }
      return false;
    },
    [commandStore, value, slashIndex, prefixPart, onCommandSelect, onAutocomplete]
  );

  const selectCommand = useCallback(
    (command: SlashCommand) => {
      const slashPart = value.slice(slashIndex);
      const args = slashPart.slice(command.trigger.length).trim();
      commandStore.close();
      onCommandSelect(command, args, prefixPart);
    },
    [commandStore, value, slashIndex, prefixPart, onCommandSelect]
  );

  return {
    isOpen: commandStore.isOpen,
    results: commandStore.results,
    selectedIndex: commandStore.selectedIndex,
    handleKeyDown,
    selectCommand,
    close: commandStore.close,
  };
}
