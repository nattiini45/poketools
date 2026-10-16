'use client';

/**
 * The viewer's favourite lines (draft-frontend §5.1). Loaded once, never in
 * the 3 s poll. A toggle is optimistic and rolls back on failure; the caller
 * shows the error (`onError`, an `ApiErrorLike`, never text).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { LineId } from '@/lib/draft-ui/snapshot-types';
import type { DraftDataSource } from '../data-source';

const EMPTY: ReadonlySet<LineId> = new Set();

export function useFavorites<Index>(
  source: DraftDataSource<Index>,
  enabled: boolean,
  onError?: (error: ApiErrorLike) => void,
): { favorites: ReadonlySet<LineId>; toggle(lineId: LineId): void } {
  const [favorites, setFavorites] = useState<ReadonlySet<LineId>>(EMPTY);
  // Decides each toggle synchronously from the latest set (updaters run lazily).
  const favRef = useRef<ReadonlySet<LineId>>(EMPTY);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const commit = useCallback((next: ReadonlySet<LineId>) => {
    favRef.current = next;
    setFavorites(next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void source.getFavorites().then((ids) => {
      if (!cancelled) commit(new Set(ids));
    });
    return () => {
      cancelled = true;
    };
  }, [source, enabled, commit]);

  const toggle = useCallback(
    (lineId: LineId) => {
      if (!enabled) return;
      const on = !favRef.current.has(lineId);
      const optimistic = new Set(favRef.current);
      if (on) optimistic.add(lineId);
      else optimistic.delete(lineId);
      commit(optimistic);
      void source.setFavorite(lineId, on).then((result) => {
        if (result.ok) {
          commit(new Set(result.data));
          return;
        }
        const rollback = new Set(favRef.current);
        if (on) rollback.delete(lineId);
        else rollback.add(lineId);
        commit(rollback);
        onErrorRef.current?.(result.error);
      });
    },
    [source, enabled, commit],
  );

  return { favorites: enabled ? favorites : EMPTY, toggle };
}
