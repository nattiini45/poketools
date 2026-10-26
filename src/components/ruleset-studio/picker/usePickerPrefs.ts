'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CatalogKind } from '@/lib/pkmn/catalog-index';
import { isDensity, type Density } from '@/lib/ruleset-studio/editor/picker/layout';
import { SORTS_BY_KIND, defaultSort, type SortSpec } from '@/lib/ruleset-studio/editor/picker/view';

/** The per-viewer conveniences the picker remembers. Browser storage can be empty or throw: everything has a default. */
const STORAGE_KEY = 'ruleset-studio:picker:v1';

interface StoredPrefs {
  density?: Density;
  includeFormes?: boolean;
  sort?: Partial<Record<CatalogKind, SortSpec>>;
}

const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function isSort(kind: CatalogKind, value: unknown): value is SortSpec {
  if (typeof value !== 'object' || value === null) return false;
  const { key, direction } = value as Record<string, unknown>;
  return (SORTS_BY_KIND[kind] as readonly unknown[]).includes(key) && (direction === 'asc' || direction === 'desc');
}

function parse(raw: string): StoredPrefs {
  if (raw === '') return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const source = value as Record<string, unknown>;
    const prefs: StoredPrefs = {};
    if (isDensity(source.density)) prefs.density = source.density;
    if (typeof source.includeFormes === 'boolean') prefs.includeFormes = source.includeFormes;
    if (typeof source.sort === 'object' && source.sort !== null) {
      const sort: Partial<Record<CatalogKind, SortSpec>> = {};
      for (const kind of Object.keys(SORTS_BY_KIND) as CatalogKind[]) {
        const candidate = (source.sort as Record<string, unknown>)[kind];
        if (isSort(kind, candidate)) sort[kind] = candidate;
      }
      prefs.sort = sort;
    }
    return prefs;
  } catch {
    return {};
  }
}

function write(next: StoredPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is a convenience: without it the choice lasts until the page closes.
  }
  for (const listener of listeners) listener();
}

/** A media query as a boolean (false on the server and until the browser answers). */
export function useMediaQuery(query: string): boolean {
  const subscribeQuery = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribeQuery,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The size of an element in CSS pixels, kept current by a ResizeObserver (0 x 0 until it first reports). `ref` is a callback
 * ref on purpose: the picker renders its list wrapper only after the catalog index has loaded, so the element mounts later
 * than the hook does, and an effect over a ref object would have run once, found nothing and never observed anything.
 */
export function useElementSize<T extends HTMLElement>(): { ref: (element: T | null) => void; width: number; height: number } {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const next = { width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0) };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref: setElement, ...size };
}

export interface PickerPrefs {
  /** The remembered density, or null when the viewer never chose one (the default then depends on the screen). */
  density: Density | null;
  includeFormes: boolean;
  sortFor: (kind: CatalogKind) => SortSpec;
  setDensity: (density: Density) => void;
  setIncludeFormes: (value: boolean) => void;
  setSort: (kind: CatalogKind, sort: SortSpec) => void;
}

export function usePickerPrefs(): PickerPrefs {
  const raw = useSyncExternalStore(subscribe, readRaw, () => '');
  const prefs = useMemo(() => parse(raw), [raw]);
  return {
    density: prefs.density ?? null,
    includeFormes: prefs.includeFormes ?? true,
    sortFor: (kind) => prefs.sort?.[kind] ?? defaultSort(kind),
    setDensity: (density) => write({ ...parse(readRaw()), density }),
    setIncludeFormes: (includeFormes) => write({ ...parse(readRaw()), includeFormes }),
    setSort: (kind, sort) => write({ ...parse(readRaw()), sort: { ...parse(readRaw()).sort, [kind]: sort } }),
  };
}
