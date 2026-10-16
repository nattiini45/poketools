'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WORLD_OVERRIDE_URL_PARAM } from '@/lib/worlds/registry';
import { clearInvalidStoredWorldOverride, isRegisteredRouteThemeId, readStoredWorldOverride } from './world-override-store';

/**
 * Mirrors a persisted viewer preference into the address bar.
 *
 * The world a visitor gets is resolved on the SERVER, because that is the only
 * place the scene root, the shell's token namespace, the station manifest and
 * the DOM sections can all be chosen together. localStorage is invisible to
 * the server, so a stored pick is surfaced as the `?world=` param the server
 * already reads first in the precedence chain.
 *
 * This is a same-document `router.replace`, not a reload: it preserves the
 * path, every other query param (`?team=`, `?mon=`) and the hash anchor, and
 * keeps scroll position. It only fires when the URL carries no valid pick of
 * its own — an explicit, registered `?world=` (e.g. from a shared link) beats
 * the stored preference per the documented precedence (URL param, then
 * localStorage) and is never overwritten (PR #63 review). A viewer who never
 * changed the theme never pays for the replace, and neither does SSR.
 *
 * It re-checks on every same-page navigation (the search params are a
 * dependency): a link rendered before the mirror landed, such as a league hub
 * tab clicked during the first round trip, can navigate to a URL without the
 * pick, and the page keeps this component mounted across search-param changes.
 */
export default function WorldOverrideRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // A stored id the registry cannot resolve is ignored by the read below,
    // but left in place it would re-activate the moment a theme package with
    // that id lands. This effect is the only client reader of the store, so
    // the cleanup lives here rather than inside the read.
    clearInvalidStoredWorldOverride();
    const stored = readStoredWorldOverride();
    if (stored === null) return;

    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(WORLD_OVERRIDE_URL_PARAM);
    if (fromUrl !== null && isRegisteredRouteThemeId(fromUrl)) return;

    // Absent or unregistered param: mirror the stored pick so the server
    // resolves the whole world from it.
    url.searchParams.set(WORLD_OVERRIDE_URL_PARAM, stored);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [router, searchParams]);

  return null;
}
