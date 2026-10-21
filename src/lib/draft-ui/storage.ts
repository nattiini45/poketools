/**
 * Per-viewer browser storage for the draft UI (draft-frontend §5.1, §5.8,
 * FR-2). Every access is wrapped in try/catch and guarded by
 * `typeof window`: storage may be missing (SSR), blocked or full, and the UI
 * must render without it. Only conveniences live here (preferences, the
 * pinned line, notification opt-in and dedupe), never draft state.
 */
import { NOTIFY_DEDUPE_TTL_MS } from './constants';
import type { NotifyKind } from './notify-schedule';
import type { LineId } from './snapshot-types';

export type DraftStorageArea = 'local' | 'session';

/** Every key the draft UI writes. */
export type DraftStorageKey =
  | 'draft:prefs:v1'
  | `draft:pinned:${string}`
  | `draft:notify:${string}`
  | `draft:notified:${string}:${string}:${NotifyKind}`;

export const PREFS_KEY = 'draft:prefs:v1' satisfies DraftStorageKey;
const NOTIFIED_PREFIX = 'draft:notified:';

export const pinnedKey = (poolId: string): DraftStorageKey => `draft:pinned:${poolId}`;
export const notifyOptInKey = (poolId: string): DraftStorageKey => `draft:notify:${poolId}`;
export const notifiedKey = (poolId: string, slotId: string, kind: NotifyKind): DraftStorageKey =>
  `draft:notified:${poolId}:${slotId}:${kind}`;

function area(which: DraftStorageArea): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return which === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function storageGet(which: DraftStorageArea, key: DraftStorageKey): string | null {
  try {
    return area(which)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the value could not be stored. */
export function storageSet(which: DraftStorageArea, key: DraftStorageKey, value: string): boolean {
  try {
    const store = area(which);
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(which: DraftStorageArea, key: DraftStorageKey): void {
  try {
    area(which)?.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/** Parsed JSON or null; the caller validates the shape. */
export function storageGetJson(which: DraftStorageArea, key: DraftStorageKey): unknown {
  const raw = storageGet(which, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function storageSetJson(which: DraftStorageArea, key: DraftStorageKey, value: unknown): boolean {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  return storageSet(which, key, raw);
}

// ── Finder preferences (stage mode, sort, show drafted) ────────────────────

/** The stored preferences, unvalidated (the finder reducer owns the shape). */
export function readPrefs(): unknown {
  return storageGetJson('local', PREFS_KEY);
}

export function writePrefs(prefs: unknown): boolean {
  return storageSetJson('local', PREFS_KEY, prefs);
}

// ── Pinned line (per pool, per tab) ─────────────────────────────────────────

export function readPinned(poolId: string): LineId | null {
  const value = storageGet('session', pinnedKey(poolId));
  return value === null || value === '' ? null : value;
}

export function writePinned(poolId: string, lineId: LineId | null): void {
  if (lineId === null) storageRemove('session', pinnedKey(poolId));
  else storageSet('session', pinnedKey(poolId), lineId);
}

// ── Notifications: per-pool opt-in and cross-tab dedupe ─────────────────────

export function isNotifyOptedIn(poolId: string): boolean {
  return storageGet('local', notifyOptInKey(poolId)) === '1';
}

export function setNotifyOptIn(poolId: string, on: boolean): void {
  storageSet('local', notifyOptInKey(poolId), on ? '1' : '0');
}

export function hasNotified(poolId: string, slotId: string, kind: NotifyKind): boolean {
  return storageGet('local', notifiedKey(poolId, slotId, kind)) !== null;
}

/** Stores when an alert went out (epoch ms), so other tabs skip it. */
export function markNotified(poolId: string, slotId: string, kind: NotifyKind, now: number): void {
  storageSet('local', notifiedKey(poolId, slotId, kind), String(now));
}

/** Removes dedupe entries older than `maxAgeMs` (or unreadable). Returns how many were removed. */
export function pruneNotified(now: number, maxAgeMs: number = NOTIFY_DEDUPE_TTL_MS): number {
  const store = area('local');
  if (!store) return 0;
  const stale: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key === null || !key.startsWith(NOTIFIED_PREFIX)) continue;
      const at = Number(store.getItem(key));
      if (!Number.isFinite(at) || now - at > maxAgeMs) stale.push(key);
    }
    for (const key of stale) store.removeItem(key);
  } catch {
    return 0;
  }
  return stale.length;
}
