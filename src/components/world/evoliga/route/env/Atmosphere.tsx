'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import PaintedSkyDome from '@/components/world/route/env/PaintedSkyDome';
import { usePlazaPalette } from '@/components/world/themes/plaza/use-plaza-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import Skyline from './Skyline';

/**
 * Painted sky + skyline + the fog the painted air rides in (LOOK-PLAN §2
 * SEAT K). ROLLOUT §2.2 (d): the dome and its uniform writer are the shared
 * `route/env/PaintedSkyDome` over the plaza's paint block (`paint.sky` =
 * `PLAZA_SKY_PRESET`, today's literals; `features.paintedSky` on); the
 * skyline is the shared `PaintedSkyline` (via `./Skyline`). The sky material is created ONCE:
 * night, palette and the rung's cloud taps are uniform writes, so a theme
 * toggle or a governor step never relinks it. Fog density follows the
 * station channel; fog colour is the horizon token.
 */

/**
 * Day-only fog density scale: 0 since the painterly pilot (LOOK-PLAN §2
 * K.4). The aerial term inside every painted material (SEAT L,
 * `painted-light.ts`) now carries depth — a luminance-preserving chroma
 * shift plus a capped value lift — so the legacy FogExp2 mix is off by day.
 * `scene.fog` stays MOUNTED: the aerial block lives inside three's USE_FOG
 * branch. Night keeps the station density law verbatim.
 *
 * History (C-044): day fog was scaled to 0.25 because `FogExp2` mixes every
 * lit surface toward the bright horizon token by depth — an albedo-
 * insensitive additive that floored dark façades near a common value.
 */
const DAY_FOG_SCALE = 0;

export default function Atmosphere() {
  const { conductor, sampleWorldState, theme } = useWorldState();
  const palette = usePlazaPalette();
  const quality = useQuality();
  const fogRef = useRef<THREE.FogExp2>(null);
  const night = palette.exposure < 0.75;
  // Belt and braces: RouteScene guarantees a theme; the plaza definition is
  // the fallback of record if this ever mounts without one.
  const skyBodyPosition = (theme ?? plazaTheme).lights.skyBodyPosition;

  useFrame(() => {
    const fog = fogRef.current;
    if (!fog) return;
    fog.density =
      sampleWorldState(conductor.progress.current.smooth).fog * (night ? 1 : DAY_FOG_SCALE);
    fog.color.set(palette.skyHorizon);
  });

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={[palette.skyHorizon, 0.006]} />
      <PaintedSkyDome
        paint={plazaTheme.paint}
        palette={palette}
        night={night}
        post={quality.post}
        cloudTaps={quality.cloudTaps}
        skyBodyPosition={skyBodyPosition}
      />
      <ResidentSuspense id="plaza-skyline">
        <Skyline night={night} />
      </ResidentSuspense>
    </>
  );
}
