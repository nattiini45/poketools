'use client';

import {
  useId,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils/cn';
import { rankedSearch, type SearchKeys } from '@/lib/pkmn/i18n/search';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

/* ─── Types ────────────────────────────────────────────────────────── */

export interface ComboboxOption {
  /** Display label */
  label: string;
  /** Unique value (selected on pick) */
  value: string;
  /** Arbitrary payload rendered via `renderOption` */
  meta?: Record<string, unknown>;
  /**
   * Shown but not pickable (e.g. "already on the roster"): `aria-disabled`, skipped by the arrow
   * keys, and a click or Enter leaves the dropdown open. The caller's `renderOption` shows why.
   */
  disabled?: boolean;
}

/**
 * The term an async picker searches for: the query without surrounding whitespace, or `null` while it
 * is shorter than `minQueryLength` (a blank query is no query: the API refuses it).
 */
export function asyncSearchTerm(query: string, minQueryLength: number): string | null {
  const term = query.trim();
  return term.length < minQueryLength ? null : term;
}

/** The next pickable option from `from` in direction `dir` (1 / -1); `from` itself when there is none. */
export function nextEnabledIndex(options: readonly ComboboxOption[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
    if (!options[i].disabled) return i;
  }
  return from;
}

/**
 * Picks `option`: calls `onChange` with its value and returns `true`. A disabled option is not
 * pickable, so nothing is called and `false` comes back (the caller then leaves the dropdown open).
 * Click and Enter both pick through here.
 */
export function pickOption(option: ComboboxOption, onChange: (value: string) => void): boolean {
  if (option.disabled) return false;
  onChange(option.value);
  return true;
}

/**
 * Splits `text` around the first case-insensitive occurrence of `term` for highlighting, or `null`
 * when there is no term or no match. An async picker passes the trimmed term it searched for.
 */
export function splitHighlight(text: string, term: string): { before: string; match: string; after: string } | null {
  if (!term) return null;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return null;
  return { before: text.slice(0, idx), match: text.slice(idx, idx + term.length), after: text.slice(idx + term.length) };
}

interface ComboboxBaseProps {
  /** Field label shown above input */
  label?: string;
  /** Currently selected value (controlled) */
  value: string;
  /** Called when user picks an option or clears */
  onChange: (value: string) => void;
  /** Input placeholder */
  placeholder?: string;
  /** Custom renderer for each dropdown option */
  renderOption?: (option: ComboboxOption, highlighted: boolean) => ReactNode;
  /** Inline content rendered inside the input area when not searching (e.g. type badges) */
  renderInlineTags?: () => ReactNode;
  /** Extra class on root wrapper */
  className?: string;
  /** Disable the input */
  disabled?: boolean;
  /**
   * Static mode: the match keys of an option (e.g. `pkmnSearchKeys` for a
   * Pokémon name, so English and German queries both match). Without it the
   * query is matched against the label, as before.
   */
  matchKeys?: (option: ComboboxOption) => SearchKeys;
}

interface AsyncComboboxProps extends ComboboxBaseProps {
  mode: 'async';
  /** URL template — `{q}` is replaced with the encoded query */
  fetchUrl: string;
  /** Transform raw API JSON → ComboboxOption[] (also called with the JSON body of a refusal) */
  transformResults: (json: unknown) => ComboboxOption[];
  /**
   * Called when a search gets no JSON answer at all (network failure, an HTML
   * 502). Without it such a failure only shows as "no results".
   */
  onFetchError?: (error: unknown) => void;
  /** Characters typed before the first search (default 2). */
  minQueryLength?: number;
  staticOptions?: never;
}

interface StaticComboboxProps extends ComboboxBaseProps {
  mode: 'static';
  /** Full list filtered client-side */
  staticOptions: ComboboxOption[];
  fetchUrl?: never;
  transformResults?: never;
  onFetchError?: never;
  minQueryLength?: never;
}

export type ComboboxProps = AsyncComboboxProps | StaticComboboxProps;

/* ─── Component ────────────────────────────────────────────────────── */

export default function Combobox(props: ComboboxProps) {
  const {
    label,
    value,
    onChange,
    placeholder = '',
    renderOption,
    renderInlineTags,
    className = '',
    disabled = false,
    matchKeys,
    mode,
  } = props;
  const t = useT(uiMessages);
  /** Characters typed before a search runs, and before an empty result is reported. */
  const minQueryLength = props.minQueryLength ?? 2;

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The in-flight search; a newer query aborts it so a slow answer never overwrites a newer one. */
  const requestRef = useRef<AbortController | null>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const inputId = `${uid}-input`;

  /* ── Async fetch ──────────────────────────────────────────────────── */

  const fetchAsync = useCallback(
    (q: string) => {
      if (mode !== 'async') return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestRef.current?.abort();
      requestRef.current = null;
      const term = asyncSearchTerm(q, minQueryLength);
      if (term === null) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        const controller = new AbortController();
        requestRef.current = controller;
        try {
          const url = props.fetchUrl.replace('{q}', encodeURIComponent(term));
          const res = await fetch(url, { signal: controller.signal });
          const json: unknown = await res.json();
          if (controller.signal.aborted) return;
          setOptions(props.transformResults(json));
        } catch (err) {
          if (controller.signal.aborted) return;
          setOptions([]);
          props.onFetchError?.(err);
        } finally {
          if (requestRef.current === controller) {
            requestRef.current = null;
            setLoading(false);
          }
        }
      }, 200);
    },
    [mode, props, minQueryLength],
  );

  // Unmount: drop a pending debounce and abort an in-flight search.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestRef.current?.abort();
    },
    [],
  );

  /* ── Static filter ────────────────────────────────────────────────── */

  const filterStatic = useCallback(
    (q: string) => {
      if (mode !== 'static') return;
      if (!q) {
        setOptions(props.staticOptions.slice(0, 30));
        return;
      }
      if (matchKeys) {
        setOptions(rankedSearch(props.staticOptions, q, matchKeys, { limit: 30 }));
        return;
      }
      const lower = q.toLowerCase();
      setOptions(
        props.staticOptions
          .filter((o) => o.label.toLowerCase().includes(lower))
          .slice(0, 30),
      );
    },
    [mode, props, matchKeys],
  );

  /* ── Input change ─────────────────────────────────────────────────── */

  function handleInputChange(q: string) {
    setQuery(q);
    setHighlightIdx(-1);
    setOpen(true);
    if (mode === 'async') fetchAsync(q);
    else filterStatic(q);
  }

  /* ── Selection ────────────────────────────────────────────────────── */

  function selectOption(opt: ComboboxOption) {
    if (!pickOption(opt, onChange)) return;
    setQuery('');
    setOptions([]);
    setOpen(false);
    setHighlightIdx(-1);
  }

  function handleClear() {
    onChange('');
    setQuery('');
    setOptions([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  /* ── Keyboard ─────────────────────────────────────────────────────── */

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true);
        if (mode === 'static') filterStatic(query);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => nextEnabledIndex(options, prev, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => (prev < 0 ? nextEnabledIndex(options, -1, 1) : nextEnabledIndex(options, prev, -1)));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < options.length) {
          selectOption(options[highlightIdx]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setHighlightIdx(-1);
        break;
    }
  }

  /* ── Scroll highlighted item into view ────────────────────────────── */

  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  /* ── Outside click → close ────────────────────────────────────────── */

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHighlightIdx(-1);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  /* ── Focus handler: open static options ───────────────────────────── */

  function handleFocus() {
    setOpen(true);
    if (mode === 'static' && options.length === 0) {
      filterStatic(query);
    }
  }

  /* ── Display value ────────────────────────────────────────────────── */

  const displayValue = open ? query : value;
  /** What an async search was (or would be) run for; the empty-state hints key off it. */
  const searchedQuery = mode === 'async' ? query.trim() : query;

  /* ── Highlight matching text ──────────────────────────────────────── */

  function highlightMatch(text: string) {
    const parts = splitHighlight(text, searchedQuery);
    if (!parts) return text;
    return (
      <>
        {parts.before}
        <span className="font-bold text-poke-blue">{parts.match}</span>
        {parts.after}
      </>
    );
  }

  /* ── Default option renderer ──────────────────────────────────────── */

  function defaultRenderOption(opt: ComboboxOption, highlighted: boolean) {
    return (
      <span className={`block truncate ${highlighted ? 'text-poke-text-primary' : 'text-poke-text-secondary'}`}>
        {highlightMatch(opt.label)}
      </span>
    );
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-heading font-semibold text-poke-text-secondary mb-1">
          {label}
        </label>
      )}

      <div className="relative">
        {/* When we have inline tags and are NOT searching, show tags inside the input area */}
        {renderInlineTags && value && !open ? (
          <div
            onClick={() => { inputRef.current?.focus(); }}
            className={cn(
              'flex items-center gap-2 w-full p-2 pr-8 cursor-text',
              'border border-poke-border bg-poke-surface rounded-poke-md',
              'text-sm text-poke-text-primary transition-colors',
            )}
          >
            <span className="font-medium truncate">{value}</span>
            {renderInlineTags()}
          </div>
        ) : null}

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-activedescendant={
            highlightIdx >= 0 ? `${listId}-opt-${highlightIdx}` : undefined
          }
          aria-label={label ? undefined : placeholder || undefined}
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className={`
            w-full p-2 pr-8
            border border-poke-border bg-poke-surface rounded-poke-md
            text-sm text-poke-text-primary placeholder:text-poke-text-muted
            focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20
            transition-colors disabled:opacity-50
            ${renderInlineTags && value && !open ? 'sr-only' : ''}
          `}
        />

        {/* Clear button */}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-poke-text-muted hover:text-poke-text-primary transition-colors"
            aria-label={t('combobox.clear')}
            tabIndex={-1}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (options.length > 0 || loading) && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-20 w-full mt-1 bg-poke-surface border border-poke-border rounded-poke-md shadow-poke-lg max-h-56 overflow-y-auto"
        >
          {loading && (
            <li className="px-3 py-2 text-sm text-poke-text-muted flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-poke-text-muted border-t-transparent rounded-full animate-spin" />
              {t('combobox.searching')}
            </li>
          )}
          {!loading && options.length === 0 && searchedQuery.length >= minQueryLength && (
            <li className="px-3 py-2 text-sm text-poke-text-muted">{t('combobox.noResults')}</li>
          )}
          {!loading &&
            options.map((opt, i) => (
              <li
                key={opt.value}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === highlightIdx}
                aria-disabled={opt.disabled ? true : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
                onMouseEnter={() => {
                  if (!opt.disabled) setHighlightIdx(i);
                }}
                className={`
                  px-3 py-1.5 text-sm transition-colors
                  ${opt.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
                  ${i === highlightIdx ? 'bg-poke-elevated text-poke-text-primary' : opt.disabled ? '' : 'hover:bg-poke-elevated/50'}
                `}
              >
                {(renderOption ?? defaultRenderOption)(opt, i === highlightIdx)}
              </li>
            ))}
        </ul>
      )}

      {/* No results hint for open + empty */}
      {open && !loading && options.length === 0 && searchedQuery.length >= minQueryLength && mode === 'async' && (
        <div className="absolute z-20 w-full mt-1 bg-poke-surface border border-poke-border rounded-poke-md shadow-poke-lg px-3 py-2 text-sm text-poke-text-muted">
          {t('combobox.noResultsFor', { query: searchedQuery })}
        </div>
      )}
    </div>
  );
}
