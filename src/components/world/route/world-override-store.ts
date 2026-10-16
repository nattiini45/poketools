'use client';

import { getRegisteredRouteThemeIds, WORLD_OVERRIDE_STORAGE_KEY } from '@/lib/worlds/registry';

/**
 * The viewer's persisted 3D world override — the repo's ONLY
 * `window.localStorage` consumer for world/theme state, so the key, its
 * validation and its cleanup all have one owner.
 *
 * World/theme RESOLUTION stays server-side (`resolveViewerWorld` reads the
 * `?world=` param first); nothing here re-resolves the mounted theme, which is
 * what stops a switch from mixing one theme's palette over another theme's
 * furniture.
 *
 * The rules that make this safe remain law:
 * - the stored pick never reaches SSR output — the only reader is
 *   `WorldOverrideRedirect`'s mount effect, and the only writer is the
 *   switcher's click handler through `writeWorldOverride`;
 * - reads validate and never delete; the one cleanup is
 *   `clearInvalidStoredWorldOverride`, called from that same effect where side
 *   effects are legal;
 * - the stored value is a theme id validated against the registry, never user
 *   content rendered anywhere.
 */

/**
 * A route-theme id the SERVER can resolve. Validated against the world
 * registry — the same list `resolveViewerWorld` validates `?world=` with —
 * never the theme-package registry or the DB CHECK list (which may name
 * themes whose packages have not landed yet). This store decides whether a
 * stored pick is honored and whether an explicit `?world=` beats it, so a
 * client/server list divergence here would invert that precedence (PR #63
 * review).
 */
export function isRegisteredRouteThemeId(id: string): boolean {
  return getRegisteredRouteThemeIds().includes(id);
}

/**
 * The persisted preference alone, ignoring the URL — used by
 * `WorldOverrideRedirect` to mirror a stored pick into the address bar so the
 * SERVER can resolve the whole world from it. Returns null when nothing valid
 * is stored.
 */
export function readStoredWorldOverride(): string | null {
  const stored = window.localStorage.getItem(WORLD_OVERRIDE_STORAGE_KEY);
  return stored !== null && isRegisteredRouteThemeId(stored) ? stored : null;
}

/**
 * Drop a stored id the registry cannot resolve — a theme package that was
 * removed, or hand-edited storage. Readers already ignore such a value; this
 * stops it lingering until a package with that id lands and silently
 * re-activates it.
 */
export function clearInvalidStoredWorldOverride(): void {
  const stored = window.localStorage.getItem(WORLD_OVERRIDE_STORAGE_KEY);
  if (stored !== null && !isRegisteredRouteThemeId(stored)) {
    window.localStorage.removeItem(WORLD_OVERRIDE_STORAGE_KEY);
  }
}

/**
 * Persist the viewer override; `null` follows the season again. Non-registered
 * ids are treated as `null` — ignored AND cleared from storage.
 */
export function writeWorldOverride(id: string | null): void {
  if (id === null || !isRegisteredRouteThemeId(id)) {
    window.localStorage.removeItem(WORLD_OVERRIDE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(WORLD_OVERRIDE_STORAGE_KEY, id);
}
