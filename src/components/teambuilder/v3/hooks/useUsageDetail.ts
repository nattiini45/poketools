'use client';

import { useEffect, useState } from 'react';
import type { HybridPokemonDetail } from '@/types/usage';

// Module-level cache keyed by `species:format:seasonId`
const cache = new Map<string, HybridPokemonDetail | null>();

/**
 * Fetches per-Pokémon usage detail (move/item/ability/tera usage %) from
 * /api/usage-stats/[pokemon]. Cached per species+format for the session.
 * Returns null while loading or when no usage data exists.
 */
export function useUsageDetail(
  species: string | null | undefined,
  format: string,
  seasonId?: string | null,
): HybridPokemonDetail | null {
  const key = species ? `${species}:${format}:${seasonId ?? ''}` : null;

  const [detail, setDetail] = useState<HybridPokemonDetail | null>(() =>
    key ? (cache.get(key) ?? null) : null,
  );
  const [trackedKey, setTrackedKey] = useState(key);

  // Adjust state during render on key change (avoids setState in effect body)
  if (key !== trackedKey) {
    setTrackedKey(key);
    setDetail(key ? (cache.get(key) ?? null) : null);
  }

  useEffect(() => {
    if (!species || !key || cache.has(key)) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ format });
    if (seasonId) params.set('season_id', seasonId);

    fetch(`/api/usage-stats/${encodeURIComponent(species)}?${params}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        const data: HybridPokemonDetail | null = j.success ? (j.data ?? null) : null;
        cache.set(key, data);
        setDetail(data);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [species, format, seasonId, key]);

  return detail;
}
