'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { CatalogKind, CatalogText } from '@/lib/pkmn/catalog-index';
import {
  fetchCatalogText,
  fetchEntryIndex,
  indexUrl,
  peekCatalogText,
  peekEntryIndex,
  textUrl,
  type CatalogQuery,
  type CatalogTextQuery,
} from '@/lib/ruleset-studio/editor/catalog-client';
import type { EntryIndex } from '@/lib/ruleset-studio/editor/picker/entry-index';
import type { ApiOutcome } from '@/lib/studio-core/request';

export type IndexState<K extends CatalogKind> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiErrorLike }
  | { status: 'ready'; index: EntryIndex<K> };

/**
 * The entries of one kind, generation and scope: loading until the catalog answers, an error with a retry, then the
 * decoded index. Requests go through the module cache of `catalog-client`, which also decodes, so switching sections or
 * reopening the picker never downloads or decodes the same catalog twice; an unmounted picker abandons its wait but the
 * request still fills the cache.
 */
export function useEntryIndex<K extends CatalogKind>(query: CatalogQuery & { kind: K } | null): { state: IndexState<K>; retry: () => void } {
  const url = query === null ? '' : indexUrl(query);
  const [results, setResults] = useState<Record<string, ApiOutcome<EntryIndex>>>({});
  const [attempt, setAttempt] = useState(0);
  const cached = query === null ? undefined : peekEntryIndex(query);

  useEffect(() => {
    if (query === null || peekEntryIndex(query) !== undefined) return;
    const controller = new AbortController();
    void fetchEntryIndex(query, { signal: controller.signal }).then((outcome) => {
      if (!controller.signal.aborted) setResults((current) => ({ ...current, [url]: outcome }));
    });
    return () => controller.abort();
    // The query is rebuilt every render; its URL identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);

  const retry = useCallback(() => {
    setResults((current) => {
      const next = { ...current };
      delete next[url];
      return next;
    });
    setAttempt((n) => n + 1);
  }, [url]);

  const result = results[url];
  const state = useMemo<IndexState<K>>(() => {
    if (cached !== undefined) return { status: 'ready', index: cached };
    if (result === undefined) return { status: 'loading' };
    if (!result.ok) return { status: 'error', error: result.error };
    return { status: 'ready', index: result.data as EntryIndex<K> };
  }, [cached, result]);
  return { state, retry };
}

export interface EntryText {
  text: Readonly<Record<string, string>>;
  /** Ids whose text is English although German was asked. */
  fallback: ReadonlySet<string>;
}

const EMPTY_TEXT: EntryText = { text: {}, fallback: new Set() };

/** The descriptions of moves, items or abilities; `null` while they load (they never block the list). */
export function useEntryText(query: CatalogTextQuery | null): EntryText | null {
  const url = query === null ? '' : textUrl(query);
  const [results, setResults] = useState<Record<string, CatalogText | 'failed'>>({});
  const cached = query === null ? undefined : peekCatalogText(query);

  useEffect(() => {
    if (query === null || peekCatalogText(query) !== undefined) return;
    const controller = new AbortController();
    void fetchCatalogText(query, { signal: controller.signal }).then((outcome) => {
      if (!controller.signal.aborted) setResults((current) => ({ ...current, [url]: outcome.ok ? outcome.data : 'failed' }));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const loaded = cached ?? (results[url] === 'failed' ? undefined : (results[url] as CatalogText | undefined));
  const failed = results[url] === 'failed';
  return useMemo(() => {
    if (failed) return EMPTY_TEXT;
    return loaded === undefined ? null : { text: loaded.text, fallback: new Set(loaded.fallback) };
  }, [loaded, failed]);
}
