'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface TrackerQuickEntryProps {
  player: 1 | 2;
  slotIndex: number;
  dispatch: (action: TrackerDispatchAction) => void;
  onClose: () => void;
}

interface SearchResult {
  name: string;
}

export default function TrackerQuickEntry({
  player,
  slotIndex,
  dispatch,
  onClose,
}: TrackerQuickEntryProps) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/pkmn/search?q=${encodeURIComponent(q)}&limit=8`,
        { signal: controller.signal }
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.data ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      search(val);
    },
    [search]
  );

  const handleSelect = useCallback(
    (pokemon: string) => {
      dispatch({ type: 'set_pokemon', player, slot: slotIndex, pokemon });
      onClose();
    },
    [player, slotIndex, dispatch, onClose]
  );

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-poke-surface rounded-xl border border-poke-border shadow-poke-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-poke-border/30">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInput}
          placeholder={t('quickEntry.searchPlaceholder')}
          className="flex-1 bg-transparent text-sm text-poke-text placeholder:text-poke-text-muted outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && results.length > 0) {
              handleSelect(results[0].name);
            }
          }}
        />
        <button
          type="button"
          onClick={onClose}
          className="text-poke-text-secondary hover:text-poke-text text-sm"
          aria-label={t('quickEntry.close')}
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[240px]">
        {loading && (
          <div className="px-3 py-2 text-xs text-poke-text-secondary">{t('quickEntry.searching')}</div>
        )}
        {results.map((r) => (
          <button
            key={r.name}
            type="button"
            onClick={() => handleSelect(r.name)}
            className="flex items-center gap-2 w-full px-3 py-2 hover:bg-poke-elevated transition-colors text-left"
          >
            <PokemonSprite name={r.name} size={28} />
            <span className="text-sm text-poke-text">{localizeSpecies(r.name, dataLocale)}</span>
          </button>
        ))}
        {query.length >= 2 && !loading && results.length === 0 && (
          <div className="px-3 py-2 text-xs text-poke-text-muted">{t('quickEntry.noResults')}</div>
        )}
      </div>
    </div>
  );
}
