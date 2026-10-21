'use client';

import dynamic from 'next/dynamic';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import RouteSceneBoundary from '@/components/world/route/RouteSceneBoundary';

/**
 * Tier gate for the EvoLiga route world.
 *
 * The import is deferred rather than merely conditional, so the renderer is
 * never in the Lite payload. Tier resolves after mount, which means the first
 * paint is always the complete Lite page and the world arrives over it — the
 * enhancement can be late, it can never be a blocker.
 */
const RouteScene = dynamic(() => import('./RouteScene'), { ssr: false });

export default function EvoligaRouteWorld() {
  const { tier } = useWorldState();
  if (tier !== 'route') return null;
  return (
    <RouteSceneBoundary>
      <RouteScene />
    </RouteSceneBoundary>
  );
}
