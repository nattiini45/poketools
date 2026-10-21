'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface SpeciesResult {
  name: string;
  id: string;
}

interface InlinePokemonPickerProps {
  /** Currently committed value (a canonical species name from `@pkmn/data`). */
  value: string;
  /**
   * Called with the canonical species name when the user picks a suggestion
   * or commits a value that matches an existing species. Called with an
   * empty string when the field is cleared.
   */
  onChange: (name: string) => void;
  /** Reported alongside changes; true when the current input does not match a known species. */
  onValidityChange?: (valid: boolean) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Generation passed through to the search API. Defaults to 9. */
  gen?: number;
  /** Test id forwarded to the input element. */
  testId?: string;
}

/**
 * Typeahead Pokémon picker backed by `/api/pkmn/search?type=species&rich=1`.
 *
 * Strict mode: a value is considered valid only when it exactly matches a
 * species returned by the search API. The parent receives `false` from
 * `onValidityChange` when the user is typing a value that has not yet been
 * confirmed; this lets the enclosing form block Save until everything is
 * resolved against the dex.
 *
 * The search matches English and German names; suggestions are shown in the
 * viewer's Pokémon-name language, and the committed value is always the
 * canonical English name.
 */
export default function InlinePokemonPicker({
  value,
  onChange,
  onValidityChange,
  placeholder = 'Pokémon',
  className,
  disabled,
  gen = 9,
  testId,
}: InlinePokemonPickerProps) {
  const t = useT(matchFormsMessages);
  const dataLocale = useDataLocale();
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [committed, setCommitted] = useState(value);
  const [results, setResults] = useState<SpeciesResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);

  // Keep input synced when the parent reassigns `value`.
  useEffect(() => {
    setQuery(value);
    setCommitted(value);
  }, [value]);

  // Report validity to parent: committed is valid; in-progress edits are not.
  useEffect(() => {
    if (!onValidityChange) return;
    const trimmed = query.trim();
    const isValid = trimmed.length === 0 || trimmed === committed;
    onValidityChange(isValid);
  }, [query, committed, onValidityChange]);

  // Debounced search.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed === committed) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pkmn/search?q=${encodeURIComponent(trimmed)}&type=species&gen=${gen}`,
          { signal: ctrl.signal },
        );
        const json = await res.json();
        if (!json?.success) {
          setResults([]);
          return;
        }
        const list = Array.isArray(json.data) ? (json.data as SpeciesResult[]) : [];
        setResults(list.slice(0, 12));
        setHighlight(0);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query, committed, gen]);

  // Close on outside pointer down.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: Event) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  const commit = useCallback(
    (next: SpeciesResult) => {
      setQuery(next.name);
      setCommitted(next.name);
      setResults([]);
      setOpen(false);
      onChange(next.name);
    },
    [onChange],
  );

  /** A suggestion whose English or displayed name equals the typed text. */
  function exactMatch(text: string): SpeciesResult | undefined {
    const typed = text.trim().toLowerCase();
    return results.find(
      (r) => r.name.toLowerCase() === typed || localizeSpecies(r.name, dataLocale).toLowerCase() === typed,
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        setOpen(true);
        setHighlight((h) => (h + 1) % results.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        setOpen(true);
        setHighlight((h) => (h - 1 + results.length) % results.length);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Prefer the highlighted suggestion. Fall back to an exact name match.
      const pick = results[highlight] ?? exactMatch(query);
      if (pick) commit(pick);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery(committed);
      return;
    }
    if (e.key === 'Tab') {
      // Autocomplete to the top suggestion when leaving the field with a partial query.
      const top = results[0];
      if (top && query.trim() !== committed && query.trim().length >= 2) {
        commit(top);
      }
    }
  }

  function handleBlur() {
    // Defer so click events on suggestions still register before we collapse.
    setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        // If the user typed something that exactly matches a known species,
        // commit it; otherwise restore the previously committed value so the
        // field never holds an unverified string.
        const trimmed = query.trim();
        const exact = exactMatch(trimmed);
        if (exact) {
          commit(exact);
        } else if (trimmed === '' && committed === '') {
          setOpen(false);
        } else {
          setQuery(committed);
          setOpen(false);
        }
      }
    }, 120);
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value.trim() === '') {
            setCommitted('');
            onChange('');
          }
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && results[highlight] ? `${listboxId}-${highlight}` : undefined}
        data-testid={testId}
        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm focus:outline-none focus:ring-2 focus:ring-poke-focus/40"
      />
      {open && (results.length > 0 || loading) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 left-0 right-0 max-h-56 overflow-y-auto rounded-poke-md border border-poke-border bg-poke-surface shadow-poke-md"
        >
          {loading && results.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-poke-text-muted">{t('picker.searching')}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(r);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-2.5 py-1.5 text-sm cursor-pointer ${
                i === highlight
                  ? 'bg-poke-blue/10 text-poke-text-primary'
                  : 'text-poke-text-secondary hover:bg-poke-muted'
              }`}
            >
              {localizeSpecies(r.name, dataLocale)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
