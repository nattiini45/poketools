'use client';

/**
 * Loads and prepares the finder's search index once per URL (draft-frontend
 * §5.1). The URL carries the list version and a catalog hash, so a module
 * cache keyed by URL is safe for the whole session. While it loads, the wall
 * renders from the catalog with filters disabled.
 */
import { useEffect, useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { toApiErrorLike } from '@/i18n/api-errors';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import { prepareIndex, type PreparedIndex } from '@/lib/draft-finder/prepare';
import { DraftDataSourceError, type DraftDataSource } from '../data-source';

const prepared = new Map<string, PreparedIndex>();
const inFlight = new Map<string, Promise<PreparedIndex>>();

function errorOf(e: unknown): ApiErrorLike {
  return e instanceof DraftDataSourceError ? e.apiError : toApiErrorLike(e);
}

/** Test seam: forget every cached index. */
export function clearSearchIndexCache(): void {
  prepared.clear();
  inFlight.clear();
}

function load(source: DraftDataSource<DraftSearchIndex>, url: string): Promise<PreparedIndex> {
  const cached = prepared.get(url);
  if (cached) return Promise.resolve(cached);
  let pending = inFlight.get(url);
  if (!pending) {
    pending = source
      .fetchIndex(url)
      .then((raw) => {
        const ix = prepareIndex(raw, pkmnNameResolver);
        prepared.set(url, ix);
        return ix;
      })
      .finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
  }
  return pending;
}

export function useSearchIndex(
  source: DraftDataSource<DraftSearchIndex>,
  url: string,
  initial?: DraftSearchIndex,
): { ix: PreparedIndex | null; error: ApiErrorLike | null } {
  const [state, setState] = useState<{ url: string; ix: PreparedIndex | null; error: ApiErrorLike | null }>(() => {
    if (initial) {
      const ix = prepared.get(url) ?? prepareIndex(initial, pkmnNameResolver);
      prepared.set(url, ix);
      return { url, ix, error: null };
    }
    return { url, ix: prepared.get(url) ?? null, error: null };
  });

  const current = state.url === url ? state : { url, ix: prepared.get(url) ?? null, error: null };

  useEffect(() => {
    // A cached index is read during render (`current`); nothing to load.
    if (prepared.has(url)) return;
    let cancelled = false;
    load(source, url).then(
      (ix) => {
        if (!cancelled) setState({ url, ix, error: null });
      },
      (e: unknown) => {
        console.error('[draft-tool] search index failed to load:', e);
        if (!cancelled) setState({ url, ix: null, error: errorOf(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, url]);

  return { ix: current.ix, error: current.error };
}
