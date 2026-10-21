'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeSprite from '@/components/shared/TypeSprite';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useDataLocale, useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

interface SpeciesResult {
  name: string;
  types?: string[];
}

interface PokemonAutocompleteProps {
  value: string;
  onChange: (name: string) => void;
  generation?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function PokemonAutocomplete({
  value,
  onChange,
  generation = 9,
  placeholder,
  disabled = false,
  className = '',
}: PokemonAutocompleteProps) {
  const t = useT(uiMessages);
  const dataLocale = useDataLocale();
  const [inputValue, setInputValue] = useState(value);
  const [results, setResults] = useState<SpeciesResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const fetchResults = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setResults([]);
        setOpen(false);
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const currentFetchId = ++fetchIdRef.current;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/pkmn/search?type=pokemon&rich=1&q=${encodeURIComponent(query)}&gen=${generation}`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (fetchIdRef.current !== currentFetchId) return;
        const data = (json.data ?? []) as SpeciesResult[];
        setResults(data.slice(0, 10));
        setOpen(true);
        setHighlightedIndex(-1);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (fetchIdRef.current !== currentFetchId) return;
        setResults([]);
        setOpen(false);
      } finally {
        if (fetchIdRef.current === currentFetchId) {
          setLoading(false);
        }
      }
    },
    [generation]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setInputValue(q);
    onChange(q);
    clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => fetchResults(q), 250);
  };

  const selectItem = (name: string) => {
    setInputValue(name);
    onChange(name);
    setOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < results.length) {
        e.preventDefault();
        selectItem(results[highlightedIndex].name);
      } else {
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const handleFocus = () => {
    clearTimeout(blurTimeoutRef.current);
    if (inputValue.length >= 2 && results.length > 0) {
      setOpen(true);
    }
  };

  const handleBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      setOpen(false);
      setHighlightedIndex(-1);
    }, 150);
  };

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(blurTimeoutRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder ?? t('pokemonAutocomplete.placeholder')}
        value={inputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="w-full px-2 py-1 border border-poke-border rounded-poke-md text-sm bg-poke-surface text-poke-text-primary placeholder:text-poke-text-muted focus:outline-none focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20"
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-poke-elevated border border-poke-border rounded-poke-md shadow-lg max-h-[300px] overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-poke-text-muted flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-poke-border border-t-poke-blue rounded-full animate-spin" />
              {t('pokemonAutocomplete.searching')}
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-poke-text-muted">{t('pokemonAutocomplete.noResults')}</div>
          ) : (
            results.map((species, idx) => (
              <button
                key={species.name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectItem(species.name)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors ${
                  idx === highlightedIndex
                    ? 'bg-poke-elevated/70'
                    : 'hover:bg-poke-elevated/70'
                }`}
              >
                <PokemonSprite name={species.name} size={24} />
                <span className="text-poke-text-primary truncate flex-1">
                  {localizeSpecies(species.name, dataLocale)}
                </span>
                <div className="flex gap-0.5 shrink-0">
                  {species.types?.map((t) => (
                    <TypeSprite key={t} type={t} size={16} />
                  ))}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
