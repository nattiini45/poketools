'use client';

import { useEffect, useState } from 'react';
import type { StatSpread } from '@/types/team';
import type { Locale } from '@/i18n/config';
import { useLocale } from '@/i18n/client';

export interface SpeciesInfo {
  name: string;
  types: string[];
  baseStats: StatSpread;
}

export interface SpeciesMoveEntry {
  name: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  pp: number;
  /** In `shortDescLang` when the server localized it, else English. */
  shortDesc: string;
  /** Set by `/api/pkmn/moves/[species]?lang=de` when `shortDesc` is the German game text. */
  shortDescLang?: Locale;
}

interface SpeciesData {
  info: SpeciesInfo | null;
  moves: SpeciesMoveEntry[];
}

// Module-level cache — persists across hook mounts within the same page session.
// Keyed by species, gen and UI locale (move short descriptions come back in the viewer's language).
const cache = new Map<string, SpeciesData>();

export function useSpeciesData(species: string | null | undefined, gen = 9) {
  const locale = useLocale();
  const cacheKey = species ? `${species}:${gen}:${locale}` : null;

  const [data, setData] = useState<SpeciesData | null>(() =>
    cacheKey ? (cache.get(cacheKey) ?? null) : null,
  );
  const [loading, setLoading] = useState<boolean>(() => !!cacheKey && !cache.has(cacheKey));
  const [trackedKey, setTrackedKey] = useState(cacheKey);

  // Adjust state synchronously during render when the key changes.
  // This is React's sanctioned pattern for resetting state on prop change and
  // avoids calling setState inside the effect body (react-hooks/set-state-in-effect).
  if (cacheKey !== trackedKey) {
    setTrackedKey(cacheKey);
    setData(cacheKey ? (cache.get(cacheKey) ?? null) : null);
    setLoading(!!cacheKey && !cache.has(cacheKey));
  }

  useEffect(() => {
    if (!species || !cacheKey || cache.has(cacheKey)) return;

    const controller = new AbortController();

    Promise.all([
      fetch(
        `/api/pkmn/species-info?names=${encodeURIComponent(species)}&gen=${gen}`,
        { signal: controller.signal },
      ).then((r) => r.json()),
      fetch(
        `/api/pkmn/moves/${encodeURIComponent(species)}?gen=${gen}&lang=${locale}`,
        { signal: controller.signal },
      ).then((r) => r.json()),
    ])
      .then(([infoRes, movesRes]) => {
        const info: SpeciesInfo | null =
          infoRes.success && infoRes.data?.[0] ? (infoRes.data[0] as SpeciesInfo) : null;
        const moves: SpeciesMoveEntry[] =
          movesRes.success && movesRes.data
            ? (movesRes.data as SpeciesMoveEntry[])
            : [];
        const result: SpeciesData = { info, moves };
        cache.set(cacheKey, result);
        setData(result);
      })
      .catch(() => {
        // aborted or network error — leave state as-is
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [species, gen, locale, cacheKey]);

  return { data, loading };
}
