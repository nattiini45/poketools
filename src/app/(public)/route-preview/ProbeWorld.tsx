'use client';

import dynamic from 'next/dynamic';
import WorldNav from '@/components/world/WorldNav';
import WorldStateProvider from '@/components/world/route/WorldStateProvider';
import RouteDebugOverlay from '@/components/world/route/RouteDebugOverlay';
import HideHtmlOnRoute from '@/components/world/evoliga/route/HideHtmlOnRoute';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { PROBE_STATION_IDS, probeTheme } from './probe-theme';

/**
 * The C-100 engine-probe world (dev-only). The same tier law as every themed
 * world: the scene import is deferred, the Lite payload never carries the
 * renderer, and the 3D probe arrives over the placeholder sections. The
 * probe theme is passed DIRECTLY as `theme` — the provider's
 * direct-definition path — so the registry and the theme packages stay
 * untouched (this is the additive `?world=` render surface the card scope
 * names; the plaza default preview is unchanged).
 */

const Scene = dynamic(() => import('./ProbeWorldScene'), { ssr: false });

function ProbeRouteWorld() {
  const { tier } = useWorldState();
  if (tier !== 'route') return null;
  return <Scene />;
}

const SECTION_TITLES: readonly (readonly [string, string])[] = [
  ['pulse', 'Probe — pulse beat'],
  ['roster', 'Probe — tree line (3 skins)'],
  ['teams', 'Probe — figure row (roster + pool)'],
  ['schedule', 'Probe — bollard ring'],
  ['rules', 'Probe — rules beat'],
];

/** The nav sections WorldNav renders (same ids as the stations). */
const NAV_SECTIONS = SECTION_TITLES.map(([id, label]) => ({ id, navLabel: label }));

export default function ProbeWorld() {
  return (
    <WorldStateProvider stationIds={PROBE_STATION_IDS} theme={probeTheme} worldExperience="auto">
      <ProbeRouteWorld />
      <HideHtmlOnRoute />
      <WorldNav sections={NAV_SECTIONS} label="Probe sections" brand="Engine probe" />
      {SECTION_TITLES.map(([id, label]) => (
        <section key={id} id={id} className="min-h-screen px-6 py-24">
          <h2 className="text-xl font-semibold">{label}</h2>
        </section>
      ))}
      <RouteDebugOverlay />
    </WorldStateProvider>
  );
}
