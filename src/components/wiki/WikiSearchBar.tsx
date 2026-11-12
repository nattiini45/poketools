'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Loader2, Search } from 'lucide-react';
import { useDataLocale, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeName } from '@/lib/pkmn/i18n/names';
import type { PkmnKind } from '@/lib/pkmn/i18n/types';
import type { WikiSearchResult, WikiEntityType } from '@/types/wiki';

/** The pkmn-layer kind of each result type, for the display name (the API returns English names). */
export const RESULT_KIND: Record<WikiEntityType, PkmnKind> = {
  pokemon: 'species',
  move: 'move',
  item: 'item',
  ability: 'ability',
  tera: 'type',
};

export function getWikiPath(result: WikiSearchResult): string {
  const encodedName = encodeURIComponent(result.name);
  switch (result.type) {
    case 'pokemon':
      return `/pokemon/${encodedName}`;
    case 'move':
      return `/wiki/moves/${encodedName}`;
    case 'item':
      return `/wiki/items/${encodedName}`;
    case 'ability':
      return `/wiki/abilities/${encodedName}`;
    case 'tera':
      return `/wiki/tera/${encodedName}`;
  }
}

/**
 * The wiki search box. `/api/wiki/search` matches English and German names (with umlaut transliteration)
 * whatever the language, and returns English names; they are localized here, at display.
 */
export default function WikiSearchBar() {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WikiSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(query)}`);
        const json = await res.json() as { success: boolean; data?: WikiSearchResult[] };
        if (json.success && json.data) {
          setResults(json.data);
          setIsOpen(json.data.length > 0);
        }
      } catch {
        // Ignore search errors silently
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
        aria-hidden="true"
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        className="h-11 w-full rounded-poke-lg border border-hairline-strong bg-elevated pl-9 pr-9 font-body text-body text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
      />
      {loading && (
        <Loader2
          className="absolute right-3 top-1/2 -mt-2 h-4 w-4 animate-spin text-fg-muted motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}

      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-poke-lg border border-hairline-strong bg-surface shadow-surface-2">
          {results.map((result, idx) => (
            <li key={result.type + '-' + result.name + '-' + idx} className="border-b border-hairline last:border-b-0">
              <Link
                href={getWikiPath(result)}
                onClick={() => {
                  setIsOpen(false);
                  setQuery('');
                }}
                className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 transition-colors duration-80 hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink"
              >
                <span className="min-w-0 truncate text-body text-fg">
                  {localizeName(RESULT_KIND[result.type], result.name, dl)}
                </span>
                <span className="shrink-0 text-caption text-fg-muted">{t(`search.kind.${result.type}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
