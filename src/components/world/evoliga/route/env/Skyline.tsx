'use client';

import { plazaTheme } from '@/components/world/themes/plaza/theme';
import PaintedSkyline from '@/components/world/route/env/PaintedSkyline';

/**
 * The Lumiose skyline ring (LOOK-PLAN §2 SEAT K item 5): three open
 * cylinder bands at 70 / 100 / 140 m, alpha-cut from SEAT A's authored
 * silhouette atlas, receding toward the painted clear sky.
 *
 * ROLLOUT §2.2 (e): the ring itself is the shared `route/env/PaintedSkyline`
 * over the plaza's paint block (`paint.skyline` = `PLAZA_SKYLINE_SPEC` —
 * today's atlas, radii and mixes, unchanged; `features.skyline` on); this
 * is the plaza's wrapper. Mounted
 * inside the caller's `ResidentSuspense` (D23). Renders nothing when the
 * manifest ships no atlas.
 */
export default function Skyline({ night }: { night: boolean }) {
  return <PaintedSkyline paint={plazaTheme.paint} night={night} name="plaza-skyline" />;
}
