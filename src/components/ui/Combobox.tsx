'use client';

import {
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
  /** Transform raw API JSON → ComboboxOption[] */
  transformResults: (json: unknown) => ComboboxOption[];
  staticOptions?: never;
}

interface StaticComboboxProps extends ComboboxBaseProps {
  mode: 'static';
  /** Full list filtered client-side */
  staticOptions: ComboboxOption[];
  fetchUrl?: never;
  transformResults?: never;
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

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listId = useRef(`cb-list-${Math.random().toString(36).slice(2, 8)}`).current;

  /* ── Async fetch ──────────────────────────────────────────────────── */

  const fetchAsync = useCallback(
    (q: string) => {
      if (mode !== 'async') return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.length < 2) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const url = props.fetchUrl.replace('{q}', encodeURIComponent(q));
          const res = await fetch(url);
          const json = await res.json();
          const transformed = props.transformResults(json);
          setOptions(transformed);
        } catch {
          setOptions([]);
        } finally {
          setLoading(false);
        }
      }, 200);
    },
    [mode, props],
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
    onChange(opt.value);
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
        setHighlightIdx((prev) => Math.min(prev + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
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

  /* ── Highlight matching text ──────────────────────────────────────── */

  function highlightMatch(text: string) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="font-bold text-poke-blue">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
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
        <label className="block text-xs font-heading font-semibold text-poke-text-secondary mb-1">
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
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-activedescendant={
            highlightIdx >= 0 ? `${listId}-opt-${highlightIdx}` : undefined
          }
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
          {!loading && options.length === 0 && query.length >= 2 && (
            <li className="px-3 py-2 text-sm text-poke-text-muted">{t('combobox.noResults')}</li>
          )}
          {!loading &&
            options.map((opt, i) => (
              <li
                key={opt.value}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === highlightIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`
                  px-3 py-1.5 text-sm cursor-pointer transition-colors
                  ${i === highlightIdx ? 'bg-poke-elevated text-poke-text-primary' : 'hover:bg-poke-elevated/50'}
                `}
              >
                {(renderOption ?? defaultRenderOption)(opt, i === highlightIdx)}
              </li>
            ))}
        </ul>
      )}

      {/* No results hint for open + empty */}
      {open && !loading && options.length === 0 && query.length >= 2 && mode === 'async' && (
        <div className="absolute z-20 w-full mt-1 bg-poke-surface border border-poke-border rounded-poke-md shadow-poke-lg px-3 py-2 text-sm text-poke-text-muted">
          {t('combobox.noResultsFor', { query })}
        </div>
      )}
    </div>
  );
}
