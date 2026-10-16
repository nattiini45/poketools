import { crownSphere, crownSphereAt, planPaintedCanopy, type TreeSkin } from '@/lib/route-world/tree';

/**
 * The plaza route package's own TreeSkin DATA (C-108 criterion 3).
 * `tree.ts` sanctions exactly this path — "the reworks (C-102..04) author
 * their own skins" — so the plaza package authors its pair in-package while
 * the shared Tree system (`tree.ts` growTree + `Tree.tsx` mounter, WIND_CLOCK
 * vertex sway, quality-gated density tiers) renders them. Pure pigment data,
 * consumed by `useTreeSkinMaterials(skin)`; no texture files, no paid
 * generation.
 *
 * The Lumiose idiom is the Haussmann boulevard's planting: a fresh LINDEN
 * for the planter pairs and a deeper PLANE (platanus) for contrast — never
 * the topiary spheres this pair replaces.
 *
 * LOOK-PLAN §2 SEAT M: both skins opt into the PAINTED canopy
 * (`canopy: 'painted'` — merged brushy crown, spherical normals, vertex AO,
 * back-light translucency, draw-range density). The flag lives on the plaza
 * skins only, so sakura, mountain and clouds keep the C-100 card path.
 */

/** Warm boulevard linden bark: grey-brown with a pale ridged crest. */
const LINDEN_BARK = {
  base: { r: 86, g: 78, b: 66 },
  ridge: { r: 114, g: 104, b: 88 },
  fissure: { r: 54, g: 48, b: 40 },
} as const;

/**
 * The linden: two spring greens, the B set carrying a small pale-gold bloom
 * pass — sun catching the leaf faces over the cream stone.
 *
 * LOOK r6 (L4b, rules: "chartreuse canopies"): the leaves move to a cooler
 * BLUE-GREEN (the painter's contre-jour crown: a dark cool core, the warmth
 * only in the transmitted gold rim), and the sage bloom becomes a sparse warm
 * gold catch.
 */
export const PLAZA_LINDEN_SKIN: TreeSkin = {
  id: 'plaza-linden',
  bark: LINDEN_BARK,
  leafA: {
    base: { r: 54, g: 104, b: 70 },
    lit: { r: 120, g: 150, b: 84 },
    shadow: { r: 26, g: 56, b: 58 },
    bloom: null,
    bloomShare: 0,
  },
  leafB: {
    base: { r: 64, g: 112, b: 72 },
    lit: { r: 132, g: 158, b: 88 },
    shadow: { r: 30, g: 62, b: 60 },
    bloom: { r: 236, g: 196, b: 120 },
    bloomShare: 0.06,
  },
  cardScaleM: 1.6,
  canopy: 'painted',
};

/**
 * The plane: dustier bark, deeper cool greens — the darker mass that keeps
 * the four planters from reading monochrome. LOOK r6 (L4b): deeper
 * blue-green, no sage bloom.
 */
export const PLAZA_PLANE_SKIN: TreeSkin = {
  id: 'plaza-plane',
  bark: {
    base: { r: 98, g: 92, b: 82 },
    ridge: { r: 126, g: 118, b: 104 },
    fissure: { r: 60, g: 55, b: 47 },
  },
  leafA: {
    base: { r: 50, g: 98, b: 72 },
    lit: { r: 110, g: 144, b: 88 },
    shadow: { r: 24, g: 52, b: 56 },
    bloom: null,
    bloomShare: 0,
  },
  leafB: {
    base: { r: 44, g: 90, b: 66 },
    lit: { r: 100, g: 136, b: 82 },
    shadow: { r: 22, g: 48, b: 52 },
    bloom: null,
    bloomShare: 0,
  },
  cardScaleM: 1.7,
  canopy: 'painted',
};

/** Soil line of the Planter box — where a trunk is based. */
export const PLANTER_SOIL_Y = 0.48;

export interface PlazaTreeSeat {
  x: number;
  z: number;
  skin: 'linden' | 'plane';
  heightM: number;
  seed: number;
}

/**
 * One tree per planter seat; the north pair varies, the gate gets a formal
 * linden pair. SEATS + heights are the crown-projection-scan-of-record's
 * clean configuration (zero in-frame occlusion hits against every
 * text-bearing face at all ten landed poses). Pure data here (moved from
 * `Trees.tsx`, which re-exports it) so the shaft solver's test can read the
 * canopies without mounting React.
 */
export const PLAZA_TREE_SEATS: readonly PlazaTreeSeat[] = [
  { x: -6, z: 8, skin: 'linden', heightM: 3.4, seed: 20260981 },
  { x: 6, z: 8, skin: 'plane', heightM: 3.3, seed: 20260982 },
  { x: -9, z: 14, skin: 'linden', heightM: 4.0, seed: 20260984 },
  { x: 9, z: 14, skin: 'linden', heightM: 4.0, seed: 20260984 },
];

export const PLAZA_SKIN_BY_KEY: Readonly<Record<PlazaTreeSeat['skin'], TreeSkin>> = {
  linden: PLAZA_LINDEN_SKIN,
  plane: PLAZA_PLANE_SKIN,
};

/** A seat's yaw about +Y (the mounter's rotation). */
export function plazaTreeYaw(seat: PlazaTreeSeat): number {
  return (seat.seed % 16) * (Math.PI / 8);
}

/** Every plaza crown as a world-space sphere (the rules shafts thread these). */
export function plazaCanopies(): { center: [number, number, number]; radius: number }[] {
  return PLAZA_TREE_SEATS.map((seat) => {
    const skin = PLAZA_SKIN_BY_KEY[seat.skin];
    const plan = planPaintedCanopy({ skin, heightM: seat.heightM, seed: seat.seed });
    return crownSphereAt(crownSphere(plan.structure, skin.cardScaleM), [seat.x, PLANTER_SOIL_Y, seat.z], plazaTreeYaw(seat));
  });
}
