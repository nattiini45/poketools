'use client';

import { useEffect } from 'react';
import { useWorldState } from '../WorldStateProvider';
import { getRevealArmedAt } from '../scene-progress';
import { loadWorldManifest } from '@/lib/route-world/model-manifest';
import { type HdriRole, hdriRoleFor, hdriUrlFor } from '@/lib/route-world/world-env';

/**
 * The other palette's HDRI byte prefetch during the first load.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/** HDRI URLs already prefetched this page life (one request each, ever). */
const prefetchedHdris = new Set<string>();

/**
 * ENGINE-FIX (D32 allowance: "prefetching the other theme's HDRI bytes during
 * the load ceremony"). While the FIRST generation loads — never after its
 * reveal arm — the other palette's HDRI file is fetched into the HTTP cache
 * (bytes only: no decode, no texture, no PMREM; those stay behind the veil
 * of a later swap). The swap's own load then revalidates instead of
 * downloading. Once per URL per page life, low priority, errors ignored.
 */
export function OtherPaletteHdriPrefetch() {
  const { palette, theme } = useWorldState();
  const role = hdriRoleFor(palette.exposure);
  const format = theme?.hdriFormat ?? 'radiance';
  useEffect(() => {
    if (getRevealArmedAt() !== null) return;
    let cancelled = false;
    const other: HdriRole = role === 'night' ? 'gold' : 'night';
    loadWorldManifest()
      .then((manifest) => {
        if (cancelled || getRevealArmedAt() !== null) return;
        // The palette's own file is loaded by WorldEnvironment: never fetched here.
        prefetchedHdris.add(hdriUrlFor(manifest, role, format));
        const url = hdriUrlFor(manifest, other, format);
        if (prefetchedHdris.has(url)) return;
        prefetchedHdris.add(url);
        return fetch(url, { credentials: 'same-origin', priority: 'low' } as RequestInit)
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .catch(() => null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
    // Once per mount and palette side: the swap's own generation arms later.
  }, [role, format]);
  return null;
}
