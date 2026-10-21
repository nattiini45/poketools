'use client';

import dynamic from 'next/dynamic';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import RouteSceneBoundary from '@/components/world/route/RouteSceneBoundary';

/**
 * Tier gate for the clouds route world — the plaza's law, restated: the
 * scene import is deferred rather than merely conditional, so the renderer
 * is never in the Lite payload. The first paint is always the complete Lite
 * page (the DOM sections) and the 3D archipelago arrives over it —
 * the enhancement can be late, it can never be a blocker.
 */
const Scene = dynamic(() => import('./Scene'), { ssr: false });

export default function CloudsRouteWorld() {
  const { tier } = useWorldState();
  if (tier !== 'route') return null;
  return (
    <RouteSceneBoundary>
      <Scene />
    </RouteSceneBoundary>
  );
}
