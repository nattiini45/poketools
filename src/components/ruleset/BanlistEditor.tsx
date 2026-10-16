'use client';

import { useState, useCallback, useRef, useEffect, useId } from 'react';
import type { SearchResult } from '@/lib/pkmn/dex';
import type { ApiResult } from '@/types/api';
import Badge from '@/components/ui/Badge';
import { useDataLocale, useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { localizeName } from '@/lib/pkmn/i18n/names';
import type { PkmnKind } from '@/lib/pkmn/i18n/types';

interface BanlistEditorProps {
  label: string;
  searchType: 'species' | 'moves' | 'items' | 'abilities';
  items: string[];
  onChange: (items: string[]) => void;
}

/** The pkmn-layer kind of each search type; stored and emitted names stay English. */
const NAME_KIND: Record<BanlistEditorProps['searchType'], PkmnKind> = {
  species: 'species',
  moves: 'move',
  items: 'item',
  abilities: 'ability',
};

export default function BanlistEditor({ label, searchType, items, onChange }: BanlistEditorProps) {
  const t = useT(rulesetMessages);
  const dl = useDataLocale();
  const displayName = (name: string) => localizeName(NAME_KIND[searchType], name, dl);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = `banlist-${useId()}`;

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setHighlightedIndex(-1);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/pkmn/search?q=${encodeURIComponent(q)}&type=${searchType}`);
      const json = (await res.json()) as ApiResult<SearchResult[]>;
      if (json.success) {
        setResults(json.data.filter(r => !items.includes(r.name)));
        setHighlightedIndex(-1);
      }
    } finally {
      setSearching(false);
    }
  }, [searchType, items]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 200);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setResults([]);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const addItem = (name: string) => {
    onChange([...items, name]);
    setQuery('');
    setResults([]);
  };

  const removeItem = (name: string) => {
    onChange(items.filter(i => i !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown': {
        if (results.length === 0) return;
        e.preventDefault();
        const next = Math.min(highlightedIndex + 1, results.length - 1);
        setHighlightedIndex(next);
        scrollToIndex(next);
        break;
      }
      case 'ArrowUp': {
        if (results.length === 0) return;
        e.preventDefault();
        const prev = Math.max(highlightedIndex - 1, 0);
        setHighlightedIndex(prev);
        scrollToIndex(prev);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          // User arrow-keyed to a specific item
          addItem(results[highlightedIndex].name);
        } else if (results.length > 0) {
          // Prefer an exact case-insensitive match (English or display name), otherwise take first result
          const trimmed = query.trim().toLowerCase();
          const exactMatch = results.find(
            r => r.name.toLowerCase() === trimmed || displayName(r.name).toLowerCase() === trimmed,
          );
          addItem(exactMatch ? exactMatch.name : results[0].name);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setResults([]);
        setHighlightedIndex(-1);
        break;
      }
    }
  };

  const scrollToIndex = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  };

  const activeDescendant = highlightedIndex >= 0 ? `${listId}-option-${highlightedIndex}` : undefined;

  return (
    <div>
      <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-2">{label}</label>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {items.map(item => (
            <Badge key={item} variant="red" size="md">
              {displayName(item)}
              <button
                onClick={() => removeItem(item)}
                className="ml-1 hover:text-red-800"
                type="button"
                aria-label={t('banlist.remove', { name: displayName(item) })}
              >
                &times;
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div ref={containerRef} className="relative">
        <input
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(`banlist.search.${searchType}` as const)}
          className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-3 py-1.5 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
        />
        {searching && (
          <span className="absolute right-3 top-2 text-xs text-poke-text-muted">{t('banlist.searching')}</span>
        )}
        {results.length > 0 && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="absolute z-10 w-full bg-poke-surface border border-poke-border rounded-poke-md mt-1 max-h-48 overflow-y-auto shadow-poke-lg"
          >
            {results.map((r, i) => (
              <li key={r.id} id={`${listId}-option-${i}`} role="option" aria-selected={i === highlightedIndex}>
                <button
                  onClick={() => addItem(r.name)}
                  className={`w-full text-left px-3 py-1.5 text-sm text-poke-text-primary transition-colors ${
                    i === highlightedIndex ? 'bg-poke-elevated' : 'hover:bg-poke-elevated'
                  }`}
                  type="button"
                  tabIndex={-1}
                >
                  {displayName(r.name)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
