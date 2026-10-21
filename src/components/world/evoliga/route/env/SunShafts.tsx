'use client';

/**
 * The rules contre-jour shafts (LOOK-PLAN §1.3 "Rules", §2 SEAT M item 1).
 *
 * Up to three soft beams of the golden key slant down past the south-west
 * lime crown onto the setts left of the gate, as the #rules camera looks into
 * the low sun, plus LOOK r5's gap beams behind the gate. WHERE they stand is
 * law, not taste: `light-shafts.ts` seats them against every keep-out wedge
 * of the plaza (desktop, 768, landed 390, focus and dolly eyes of every data
 * face), and its test re-solves the table.
 *
 * ROLLOUT §2.2 (g): the layer is the shared `route/env/SunShafts` (same
 * shader, same flags); this wrapper passes the plaza's seat tables unchanged
 * (`plazaShaftSeats()` / `gapShaftSeats(keyDirection)`) and the plaza's
 * paint block (`features.sunShafts` on).
 */

import { useMemo } from 'react';
import SharedSunShafts from '@/components/world/route/env/SunShafts';
import { usePlazaPalette } from '@/components/world/themes/plaza/use-plaza-palette';
import { gapShaftSeats, plazaShaftSeats } from '@/lib/route-world/light-shafts';
import { plazaTheme } from '@/components/world/themes/plaza/theme';

export {
  GAP_SHAFT_MIN_RUNG_SHAFTS,
  SHAFT_CAPACITY,
  SHAFT_FRAGMENT,
  SHAFT_VERTEX,
  instanceCount,
  shaftColorLinear,
  shaftCount,
  shaftStrength,
} from '@/components/world/route/env/SunShafts';

export default function SunShafts() {
  const palette = usePlazaPalette();
  const night = palette.exposure < 0.75;
  const seats = plazaShaftSeats();
  const gap = useMemo(() => gapShaftSeats(plazaTheme.lights.keyDirection), []);
  return <SharedSunShafts paint={plazaTheme.paint} seats={seats} gap={gap} night={night} />;
}
