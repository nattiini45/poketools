'use client';

import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SITE_PALETTE,
  SITE_PALETTE_ATTRIBUTE,
  SITE_PALETTE_STORAGE_KEY,
  isSitePaletteId,
  type SitePaletteId,
} from './site-palettes';

/**
 * The viewer's site palette (docs/design.md § Site palettes): per device, in
 * localStorage, applied as `<html data-palette>` (absent = plaza).
 *
 * The pre-paint script (`./site-palette-script.ts`) applies the stored pick
 * before first paint; after that the truth is the attribute on `<html>`, and
 * this store keeps it, storage and the picker in step. There is no Context or
 * provider: `useSitePalette` subscribes to this tab's change event and to
 * other tabs' `storage` events directly.
 *
 * The rules that keep it safe:
 * - only a value that passes `isSitePaletteId` ever reaches `setAttribute`;
 * - reads validate and never delete; the one cleanup is
 *   `clearInvalidStoredSitePalette`, called from the picker's mount effect;
 * - every storage access is wrapped: storage that throws (private mode,
 *   blocked site data) never breaks the page, and a pick still applies for
 *   this page view;
 * - the palette never touches `data-theme` (next-themes owns light/dark), and
 *   `WorldStateProvider` does not observe `data-palette` (I3: a palette switch
 *   starts no theme veil and no scene generation).
 */

/** Dispatched on `window` after this tab changes the palette. */
export const SITE_PALETTE_CHANGE_EVENT = 'poketools:site-palette-change';

/**
 * The palette this tab means to show, once something chose it (a pick here, or
 * another tab's `storage` event); null until then, when storage decides. It
 * lets `reconcileSitePalette` restore a pick that storage could not keep
 * (private mode) and drop one another tab replaced.
 */
let intendedPalette: SitePaletteId | null = null;

/** > 0 while `withDefaultSitePalette` deliberately shows plaza: no reconciling. */
let reconcilePaused = 0;

/** Pages the palette never applies to (mirrors the pre-paint script). */
const BROADCAST_PATH = /^\/broadcast(\/|$)/;

/** The palette that should be applied: this tab's choice, else storage, else plaza. */
export function intendedSitePalette(): SitePaletteId {
  return intendedPalette ?? readStoredSitePalette() ?? DEFAULT_SITE_PALETTE;
}

function setIntendedSitePalette(id: SitePaletteId): void {
  intendedPalette = id;
}

/** Tests only: forget this tab's choice and any pause. */
export function resetSitePaletteStateForTests(): void {
  intendedPalette = null;
  reconcilePaused = 0;
}

/**
 * Put the intended palette back on <html> when something else changed it.
 * React 19 strips every attribute it did not render from the `<html>`
 * singleton when it releases or re-acquires it (StrictMode's simulated
 * remount in dev does both on load), which removes the pre-paint script's
 * `data-palette`. Returns true when it re-applied.
 */
export function reconcileSitePalette(): boolean {
  if (reconcilePaused > 0 || typeof document === 'undefined') return false;
  // Same exemption as the pre-paint script: OBS overlays look the same for everyone.
  if (typeof location !== 'undefined' && BROADCAST_PATH.test(location.pathname)) return false;
  const want = intendedSitePalette();
  if (readAppliedSitePalette() === want) return false;
  applySitePalette(want);
  window.dispatchEvent(new Event(SITE_PALETTE_CHANGE_EVENT));
  return true;
}

/**
 * Keep `data-palette` on <html> for the life of the page: reconcile now, again
 * whenever the attribute changes, and follow other tabs' picks. Mounted once
 * from the root layout (`SitePaletteGuard`), so pages without the NavBar keep
 * the palette too. Returns the cleanup.
 */
export function watchSitePaletteAttribute(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SITE_PALETTE_STORAGE_KEY) return;
    setIntendedSitePalette(isSitePaletteId(event.newValue) ? event.newValue : DEFAULT_SITE_PALETTE);
    reconcileSitePalette();
  };
  window.addEventListener('storage', onStorage);
  const observer =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          reconcileSitePalette();
        });
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: [SITE_PALETTE_ATTRIBUTE] });
  reconcileSitePalette();
  return () => {
    observer?.disconnect();
    window.removeEventListener('storage', onStorage);
  };
}

/** The palette currently applied (<html data-palette>, validated; absent → plaza). */
export function readAppliedSitePalette(): SitePaletteId {
  if (typeof document === 'undefined') return DEFAULT_SITE_PALETTE;
  const applied = document.documentElement.getAttribute(SITE_PALETTE_ATTRIBUTE);
  return isSitePaletteId(applied) ? applied : DEFAULT_SITE_PALETTE;
}

/** The persisted pick, validated; null when absent, invalid or storage throws. Never deletes. */
export function readStoredSitePalette(): SitePaletteId | null {
  try {
    const stored = window.localStorage.getItem(SITE_PALETTE_STORAGE_KEY);
    return isSitePaletteId(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Set (non-default) or remove (plaza) the attribute on <html>. */
export function applySitePalette(id: SitePaletteId): void {
  const root = document.documentElement;
  if (id === DEFAULT_SITE_PALETTE || !isSitePaletteId(id)) {
    root.removeAttribute(SITE_PALETTE_ATTRIBUTE);
  } else {
    root.setAttribute(SITE_PALETTE_ATTRIBUTE, id);
  }
}

/** apply + persist (plaza → removeItem) + dispatch SITE_PALETTE_CHANGE_EVENT.
 *  Storage failures are caught: the pick still applies for this page view. */
export function writeSitePalette(id: SitePaletteId): void {
  const next = isSitePaletteId(id) ? id : DEFAULT_SITE_PALETTE;
  setIntendedSitePalette(next);
  applySitePalette(next);
  try {
    if (next === DEFAULT_SITE_PALETTE) {
      window.localStorage.removeItem(SITE_PALETTE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SITE_PALETTE_STORAGE_KEY, next);
    }
  } catch {
    // Storage unavailable (private mode, quota, blocked site data): the pick
    // still applies for this page view; the next load renders plaza.
  }
  window.dispatchEvent(new Event(SITE_PALETTE_CHANGE_EVENT));
}

/**
 * Run `task` with the default (plaza) palette applied, then put the viewer's
 * palette back. For output that is stored and shown to every viewer (the
 * match social image): it must not carry the capturing viewer's palette.
 *
 * Only the attribute changes: storage is untouched and no change event is
 * dispatched, so nothing persists. If the palette changes while the task
 * runs (a pick in this tab, or another tab's `storage` event), that newer
 * choice wins and nothing is restored. The page shows plaza while the task
 * runs.
 */
export async function withDefaultSitePalette<T>(task: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const previous = root.getAttribute(SITE_PALETTE_ATTRIBUTE);
  if (previous === null) return task();
  let changed = false;
  const onChange = () => {
    changed = true;
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === SITE_PALETTE_STORAGE_KEY) changed = true;
  };
  window.addEventListener(SITE_PALETTE_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  reconcilePaused++;
  root.removeAttribute(SITE_PALETTE_ATTRIBUTE);
  try {
    return await task();
  } finally {
    reconcilePaused--;
    window.removeEventListener(SITE_PALETTE_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    if (!changed && isSitePaletteId(previous)) applySitePalette(previous);
    else reconcileSitePalette();
  }
}

/** Drop a stored value that fails isSitePaletteId (hand-edited, or a removed palette). */
export function clearInvalidStoredSitePalette(): void {
  try {
    const stored = window.localStorage.getItem(SITE_PALETTE_STORAGE_KEY);
    if (stored !== null && !isSitePaletteId(stored)) {
      window.localStorage.removeItem(SITE_PALETTE_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: nothing to clean.
  }
}

/** Subscribe to this tab's changes and to other tabs' `storage` events for
 *  SITE_PALETTE_STORAGE_KEY (validates e.newValue, applies it, then notifies). */
export function subscribeSitePalette(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SITE_PALETTE_STORAGE_KEY) return;
    const next = isSitePaletteId(event.newValue) ? event.newValue : DEFAULT_SITE_PALETTE;
    setIntendedSitePalette(next);
    applySitePalette(next);
    onChange();
  };
  window.addEventListener(SITE_PALETTE_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SITE_PALETTE_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = (): SitePaletteId | null => null;

/** { palette: null on the server / before hydration, else the applied id; setPalette } */
export function useSitePalette(): { palette: SitePaletteId | null; setPalette: (id: SitePaletteId) => void } {
  const palette = useSyncExternalStore<SitePaletteId | null>(
    subscribeSitePalette,
    readAppliedSitePalette,
    serverSnapshot,
  );
  return { palette, setPalette: writeSitePalette };
}
