'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import type { SpriteStylePreference } from '@/lib/pkmn/sprite-styles';
import { loadStoredSpriteStylePreference, useSpriteStyleChange } from './sprite-style-client';

/**
 * Applies a signed-in player's account sprite style (`players.sprite_style`)
 * on every device (docs/pkmn.md, "Sprite styles"). The root layout reads only
 * the cookie (it never reads the session), so once per signed-in player and
 * browser tab this reads the account value (`GET /api/sprite-style`) and, when
 * it differs from the cookie, applies it and writes it back to the cookie
 * (`POST /api/sprite-style`, silent). The account value wins over a choice made
 * signed out on this browser.
 *
 * The cookie is the server-render source of truth; this is the reconcile for
 * the cases the server-side writes miss: an account value changed on another
 * device after this browser signed in, or a sign-in whose cookie sync failed
 * (`sprite-style-signin.server.ts`).
 *
 * A refused or failed read (a banned account's 403, a 500, offline) is logged
 * and marked for FAILED_SYNC_RETRY_MS in this tab, so reloads do not repeat
 * the request and the log line on every page; the first load after the mark
 * expires tries again.
 *
 * Mounted once, by the root layout, inside the viewer's SpriteStyleProvider;
 * never inside the (broadcast) layout's site-default provider. Renders nothing.
 */
const syncedThisPage = new Set<string>();
const failedThisPage = new Map<string, number>();

/** How long a failed read is not retried in this tab (10 minutes). */
export const FAILED_SYNC_RETRY_MS = 10 * 60 * 1000;

function storageKey(playerId: string): string {
  return `plc_sprite_style_synced:${playerId}`;
}

function failedKey(playerId: string): string {
  return `plc_sprite_style_sync_failed:${playerId}`;
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage blocked (private mode, sandboxed frame): the in-memory marks
    // alone limit the read to once per page load.
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // See readStorage: the in-memory marks still hold.
  }
}

function alreadySynced(playerId: string): boolean {
  return syncedThisPage.has(playerId) || readStorage(storageKey(playerId)) === '1';
}

/** True while a failed read of this player is younger than FAILED_SYNC_RETRY_MS. */
function recentlyFailed(playerId: string, now: number): boolean {
  const stored = Number(readStorage(failedKey(playerId)));
  const at = failedThisPage.get(playerId) ?? (Number.isFinite(stored) && stored > 0 ? stored : null);
  return at !== null && now >= at && now - at < FAILED_SYNC_RETRY_MS;
}

function markSynced(playerId: string): void {
  syncedThisPage.add(playerId);
  failedThisPage.delete(playerId);
  writeStorage(storageKey(playerId), '1');
  writeStorage(failedKey(playerId), null);
}

function markFailed(playerId: string, now: number): void {
  failedThisPage.set(playerId, now);
  writeStorage(failedKey(playerId), String(now));
}

/**
 * One sync for a signed-in player: skip when this tab already synced them or
 * a read failed less than FAILED_SYNC_RETRY_MS ago; otherwise read the account
 * value and apply it when it differs from the current preference. A failed
 * read leaves a short failure mark (the first load after it expires retries).
 * Returns what it did, for the tests.
 */
export async function syncAccountSpriteStyle(
  playerId: string,
  deps: {
    load: typeof loadStoredSpriteStylePreference;
    current: () => SpriteStylePreference;
    apply: (next: SpriteStylePreference) => Promise<unknown>;
    cancelled: () => boolean;
    now?: () => number;
  },
): Promise<'skipped' | 'deferred' | 'failed' | 'unchanged' | 'applied'> {
  const now = deps.now ?? Date.now;
  if (alreadySynced(playerId)) return 'skipped';
  if (recentlyFailed(playerId, now())) return 'deferred';
  const result = await deps.load();
  if (deps.cancelled()) return 'skipped';
  if (!result.ok) {
    markFailed(playerId, now());
    return 'failed';
  }
  markSynced(playerId);
  if (result.stored === null || result.stored === deps.current()) return 'unchanged';
  await deps.apply(result.stored);
  return 'applied';
}

export default function SpriteStyleAccountSync() {
  const { data: session } = useSession();
  const playerId = session?.player?.playerId ?? null;
  const { preference, change } = useSpriteStyleChange();
  const latest = useRef({ preference, change });

  useEffect(() => {
    latest.current = { preference, change };
  }, [preference, change]);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    void syncAccountSpriteStyle(playerId, {
      load: loadStoredSpriteStylePreference,
      current: () => latest.current.preference,
      apply: (next) => latest.current.change(next, { silent: true }),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return null;
}

/** Test seam: forget the in-memory marks. */
export function resetSpriteStyleAccountSyncForTests(): void {
  syncedThisPage.clear();
  failedThisPage.clear();
}
