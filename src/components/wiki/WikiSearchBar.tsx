'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useDataLocale, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeName } from '@/lib/pkmn/i18n/names';
import type { PkmnKind } from '@/lib/pkmn/i18n/types';
import type { WikiSearchResult, WikiEntityType } from '@/types/wiki';

/** The pkmn-layer kind of each result type, for the display name (the API returns English names). */
const RESULT_KIND: Record<WikiEntityType, PkmnKind> = {
  pokemon: 'species',
  move: 'move',
  item: 'item',
  ability: 'ability',
  tera: 'type',
};

function getWikiPath(result: WikiSearchResult): string {
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
    <div ref={containerRef} className="relative w-full max-w-lg">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder={t('search.placeholder')}
        className="w-full px-4 py-2.5 rounded-poke-lg bg-poke-surface border border-poke-border
                   text-poke-text-primary font-body placeholder:text-poke-text-secondary
                   focus:outline-none focus:ring-2 focus:ring-poke-accent shadow-poke-sm"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-poke-text-secondary text-xs">
          ...
        </span>
      )}

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-poke-surface border border-poke-border rounded-poke-lg shadow-poke-sm overflow-hidden">
          {results.map((result, idx) => (
            <Link
              key={`${result.type}-${result.name}-${idx}`}
              href={getWikiPath(result)}
              onClick={() => {
                setIsOpen(false);
                setQuery('');
              }}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-poke-muted transition-colors"
            >
              <span className="font-body text-sm text-poke-text-primary">
                {localizeName(RESULT_KIND[result.type], result.name, dl)}
              </span>
              <span className="text-xs font-heading text-poke-text-secondary uppercase tracking-wide">
                {t(`search.kind.${result.type}`)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
