'use client';

import { useMemo } from 'react';
import { isNight } from '@/lib/route-world/palette';
import type { WaterBodySpec } from '@/lib/route-world/water';
import BoundedWater, { type WaterPractical } from '@/components/world/route/water/BoundedWater';
import { WaterBodyProvider } from '@/components/world/route/water/WaterEventContext';
import { sakuraLakeColors } from '@/components/world/route/water/body-palettes';
import { useSakuraPalette } from '../use-sakura-palette';
import { sakuraTheme } from '../theme';
import { ISLAND, LAKE } from './layout';

/**
 * The lake — a thin adapter over the shared bounded water (spec §5.2,
 * `route/water/BoundedWater.tsx`, which carries the optical disclosures: an
 * analytic sky reflection plus the torii-red smear, heuristic refraction, no
 * SSR / planar mirror). Sakura's read: broad, gentle waves, blossom-tinted
 * shallows, drifting petal specks collecting toward the shore, and the
 * island lantern streaking on the water at night.
 *
 * The footprint is unchanged (`LAKE` ellipse at `LAKE.y`); the shrine island
 * and its sand collar are carved out as an inner shore, so the foam lip and
 * wet band wrap it too. Body id `sakura-lake` is what figure controllers ask
 * `useWaterBody` for.
 */

export const SAKURA_LAKE_ID = 'sakura-lake';

/** The island lantern's light box (BridgeSegment: group y 0.1, box at 0.83·s, s = 1.15). */
const ISLAND_LANTERN: WaterPractical = {
  position: [ISLAND.x - 0.4, 0.1 + 0.83 * 1.15, ISLAND.z + 0.3],
  intensity: 1,
};
const PRACTICALS: readonly WaterPractical[] = [ISLAND_LANTERN];

/** The torii stands due south of the lake: the reflection smear's azimuth. */
const TORII_DIRECTION_XZ = [0, 1] as const;

export default function Lake() {
  const palette = useSakuraPalette();
  const night = isNight(palette.exposure);

  const spec = useMemo<WaterBodySpec>(
    () => ({
      id: SAKURA_LAKE_ID,
      center: [LAKE.x, LAKE.z],
      radii: [LAKE.rx, LAKE.rz],
      surfaceY: LAKE.y,
      // The shore sand ring (y 0.012) tucks under the rim; the lawn is at 0.
      floorY: 0.012,
      depthM: 1.3,
      shoreBandM: 0.8,
      // Broad and gentle: a long swell across the lake's length, a cross
      // chop, and a fine ripple train. Σ amplitude ≈ 6 cm — the island's
      // sand collar sits 1.5 cm above rest, and the shore fade pins the
      // surface to rest along every shore, so nothing pokes through.
      waves: [
        { dirRad: 0.35, wavelengthM: 7.5, amplitudeM: 0.03, speed: 1.0, steepness: 0.3 },
        { dirRad: 2.2, wavelengthM: 3.6, amplitudeM: 0.02, speed: 0.75, steepness: 0.2 },
        { dirRad: -0.7, wavelengthM: 1.6, amplitudeM: 0.009, speed: 0.55, steepness: 0.1 },
      ],
      capillary: { scaleM: 0.5, strength: 0.07 },
      // r2: darker jade-leaning bowl + a horizon reflection lifted to a
      // guaranteed value gap over the body (`body-palettes.ts`).
      colors: sakuraLakeColors(palette, night),
      // A fish rise / a dripping branch every ~5–8 s across two streams.
      // W3 r3: the phase pin lands on the rise west of the island (open water
      // framed at the pulse station), aged AMBIENT_PIN_AGE_S.
      ambient: { periodS: 5.5, streams: 2, strength: 0.75, seed: 0x5a4b, pinNear: [-3.1, -9.6] },
      // Island + its sand collar (BridgeSegment: collar ring to r + 0.45).
      islands: [{ x: ISLAND.x, z: ISLAND.z, r: ISLAND.r + 0.45 }],
    }),
    [palette, night],
  );

  const smear = useMemo(
    () => ({ color: palette.toriiRed, directionXZ: TORII_DIRECTION_XZ, gain: 0.55 }),
    [palette.toriiRed],
  );

  return (
    <WaterBodyProvider spec={spec}>
      <BoundedWater
        spec={spec}
        sunDirection={sakuraTheme.lights.keyDirection}
        sunColor={palette.keyLight}
        night={night}
        practicals={PRACTICALS}
        practicalColor={palette.lanternGlow}
        petalColor={palette.petalColor}
        smear={smear}
      />
    </WaterBodyProvider>
  );
}
