/**
 * The browser side of the entry catalog and the preset rules: module-cached fetchers over `GET /api/pkmn/catalog/[kind]`
 * and `GET /api/pkmn/presets/[id]/rules`. A key (kind, generation, scope, preset and, for text, language) is fetched at
 * most once while it is in flight or loaded; a failure is NOT cached, so the picker's Retry asks again. Callers may pass an
 * `AbortSignal`: an aborted caller stops waiting, the shared request keeps going for the others (and for the next call).
 *
 * Client-safe: plain `fetch` through the studio core's `request`, with an injectable `fetch` for the tests.
 */
import type { CatalogIndex, CatalogKind, CatalogScope, CatalogText } from '@/lib/pkmn/catalog-index';
import type { PresetRules, TourOverlayRules } from '@/lib/pkmn/preset-rules';
import { request, type ApiOutcome, type FetchLike } from '@/lib/studio-core/request';

export interface CatalogQuery {
  kind: CatalogKind;
  gen: number;
  scope: CatalogScope;
  /** A Champions preset the rows extend for. */
  preset?: string | null;
}

export interface CatalogTextQuery extends CatalogQuery {
  kind: Exclude<CatalogKind, 'species'>;
  lang: 'en' | 'de';
}

const enc = encodeURIComponent;

/** The URL of an index request. */
export function indexUrl({ kind, gen, scope, preset }: CatalogQuery): string {
  return `/api/pkmn/catalog/${enc(kind)}?gen=${gen}&scope=${scope}${preset ? `&preset=${enc(preset)}` : ''}`;
}

/** The URL of a text request. */
export function textUrl(query: CatalogTextQuery): string {
  return `${indexUrl(query)}&part=text&lang=${query.lang}`;
}

type Slot<T> = { state: 'loading'; promise: Promise<ApiOutcome<T>> } | { state: 'ready'; outcome: ApiOutcome<T> & { ok: true } };

/** A cache of outcomes by key that dedupes in-flight requests and keeps only successes. */
class OutcomeCache<T> {
  private readonly slots = new Map<string, Slot<T>>();

  fetch(key: string, load: () => Promise<ApiOutcome<T>>, signal?: AbortSignal): Promise<ApiOutcome<T>> {
    const slot = this.slots.get(key);
    if (slot?.state === 'ready') return Promise.resolve(slot.outcome);
    let promise: Promise<ApiOutcome<T>>;
    if (slot?.state === 'loading') {
      promise = slot.promise;
    } else {
      promise = load().then((outcome) => {
        if (outcome.ok) this.slots.set(key, { state: 'ready', outcome });
        else this.slots.delete(key);
        return outcome;
      });
      this.slots.set(key, { state: 'loading', promise });
    }
    return signal === undefined ? promise : raceAbort(promise, signal);
  }

  /** The loaded value, or undefined. */
  peek(key: string): T | undefined {
    const slot = this.slots.get(key);
    return slot?.state === 'ready' ? slot.outcome.data : undefined;
  }

  clear(): void {
    this.slots.clear();
  }
}

const ABORTED = { ok: false, status: 0, error: { code: 'network_error' } } as const;

function raceAbort<T>(promise: Promise<ApiOutcome<T>>, signal: AbortSignal): Promise<ApiOutcome<T>> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then((outcome) => {
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    });
  });
}

const indexes = new OutcomeCache<CatalogIndex>();
const texts = new OutcomeCache<CatalogText>();
const presets = new OutcomeCache<PresetRules>();
const overlays = new OutcomeCache<TourOverlayRules>();

/** The entries of a kind in a generation and scope. */
export function fetchCatalogIndex<K extends CatalogKind>(
  query: CatalogQuery & { kind: K },
  options: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<ApiOutcome<CatalogIndex<K>>> {
  const url = indexUrl(query);
  return indexes.fetch(url, () => request<CatalogIndex>(options.fetch, 'GET', url), options.signal) as Promise<ApiOutcome<CatalogIndex<K>>>;
}

/** The one-line descriptions of moves, items or abilities in the viewer's language. */
export function fetchCatalogText(query: CatalogTextQuery, options: { fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<ApiOutcome<CatalogText>> {
  const url = textUrl(query);
  return texts.fetch(url, () => request<CatalogText>(options.fetch, 'GET', url), options.signal);
}

/** The resolved rules of a catalog preset. */
export function fetchPresetRules(presetId: string, options: { fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<ApiOutcome<PresetRules>> {
  const url = `/api/pkmn/presets/${enc(presetId)}/rules`;
  return presets.fetch(url, () => request<PresetRules>(options.fetch, 'GET', url), options.signal);
}

/** The documented Smogon tour extras of a draft preset (404 `ruleset_preset_unknown` for a preset without any). */
export function fetchTourOverlay(presetId: string, options: { fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<ApiOutcome<TourOverlayRules>> {
  const url = `/api/pkmn/presets/${enc(presetId)}/tour-overlay`;
  return overlays.fetch(url, () => request<TourOverlayRules>(options.fetch, 'GET', url), options.signal);
}

/** The loaded index, when it is already in the cache (the compile's `known` set reads it without waiting). */
export function peekCatalogIndex<K extends CatalogKind>(query: CatalogQuery & { kind: K }): CatalogIndex<K> | undefined {
  return indexes.peek(indexUrl(query)) as CatalogIndex<K> | undefined;
}

export function peekCatalogText(query: CatalogTextQuery): CatalogText | undefined {
  return texts.peek(textUrl(query));
}

export function peekPresetRules(presetId: string): PresetRules | undefined {
  return presets.peek(`/api/pkmn/presets/${enc(presetId)}/rules`);
}

/** Forgets everything loaded (the tests). */
export function clearCatalogCache(): void {
  indexes.clear();
  texts.clear();
  presets.clear();
  overlays.clear();
}
