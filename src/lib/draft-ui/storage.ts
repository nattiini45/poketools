/**
 * Per-viewer browser storage for the draft UI (draft-frontend §5.1, §5.8,
 * FR-2). Every access is wrapped in try/catch and guarded by
 * `typeof window`: storage may be missing (SSR), blocked or full, and the UI
 * must render without it. Only conveniences live here (preferences and the
 * pinned line), never draft state.
 */
import type { LineId } from './snapshot-types';

export type DraftStorageArea = 'local' | 'session';

/** Every key the draft UI writes. */
export type DraftStorageKey = 'draft:prefs:v1' | `draft:pinned:${string}`;

export const PREFS_KEY = 'draft:prefs:v1' satisfies DraftStorageKey;
/** Keys of the removed local turn alerts (see `clearLegacyNotifyKeys`). */
const LEGACY_NOTIFIED_PREFIX = 'draft:notified:';
const LEGACY_OPT_IN_PREFIX = 'draft:notify:';

export const pinnedKey = (poolId: string): DraftStorageKey => `draft:pinned:${poolId}`;

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

// ── Finder preferences (stage mode, sort, sort stage, show drafted, weakness stage) ──

/** The stored preferences, unvalidated (the finder reducer owns the shape). */
export function readPrefs(): unknown {
  return storageGetJson('local', PREFS_KEY);
}

/**
 * Merges `patch` into the stored preferences (fields it does not name stay, so the independent writers of the
 * blob - the finder view and the weakness overview - never overwrite each other). Returns false when the blob
 * could not be stored.
 */
export function updatePrefs(patch: Readonly<Record<string, unknown>>): boolean {
  const current = readPrefs();
  const base = typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {};
  return storageSetJson('local', PREFS_KEY, { ...base, ...patch });
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

// ── Legacy turn-alert keys ──────────────────────────────────────────────────

/**
 * Turn alerts are Web Push messages now (docs/push.md); the browser no longer keeps a per-pool opt-in
 * (`draft:notify:<pool>`) or a cross-tab dedupe stamp per alert (`draft:notified:<pool>:<slot>:<kind>`).
 * Removes what earlier versions left behind. Returns how many keys were removed.
 */
export function clearLegacyNotifyKeys(): number {
  const store = area('local');
  if (!store) return 0;
  const legacy: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key !== null && (key.startsWith(LEGACY_NOTIFIED_PREFIX) || key.startsWith(LEGACY_OPT_IN_PREFIX))) legacy.push(key);
    }
    for (const key of legacy) store.removeItem(key);
  } catch {
    return 0;
  }
  return legacy.length;
}
