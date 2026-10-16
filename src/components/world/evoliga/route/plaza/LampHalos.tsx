'use client';

import { themeKeepOut } from '@/lib/route-world/data-surfaces';
import { clearLampHalos, plazaLampHaloSeats, type LampHalo } from '@/lib/route-world/plaza-emitters';
import SharedLampHalos from '@/components/world/route/env/LampHalos';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { PLAZA_DATA_SURFACES } from './data-faces';

/**
 * LOOK r6 (L6.5, night: "the lamp glows are small"): soft rainy-night fog
 * halos round the street-lamp heads and the two gate lanterns — the one new
 * program of LOOK round 6 (D26: ≤ +1).
 *
 * ROLLOUT §2.2 (f): the layer is the shared `route/env/LampHalos` (same
 * source, same program key `plaza-lamp-halo-v1`); this wrapper hands it the
 * plaza's lawful seats (`plazaLampHaloSeats`, culled ONCE against every
 * keep-out wedge of the plaza) and the plaza's paint block
 * (`features.lampHalos` on).
 */

export { HALO_FRAGMENT, HALO_VERTEX, LAMP_HALO_PROGRAM_KEY } from '@/components/world/route/env/LampHalos';
export { haloGain } from '@/lib/route-world/lamp-halos';

/** The plaza's lawful halos (computed once — pure maths over the frozen poses). */
let haloCache: LampHalo[] | null = null;
export function plazaLampHalos(): LampHalo[] {
  haloCache ??= clearLampHalos(plazaLampHaloSeats(), (c, r) => themeKeepOut(PLAZA_DATA_SURFACES).sphereClear(c, r));
  return haloCache;
}

export default function LampHalos({ night }: { night: boolean }) {
  return <SharedLampHalos paint={plazaTheme.paint} halos={plazaLampHalos()} night={night} name="plaza-lamp-halos" />;
}
