import type { TreeSkin } from '@/lib/route-world/tree';

/**
 * The rework's own TreeSkin DATA (C-104 criterion 2) — the same sanctioned
 * path C-102 proved for sakura: `tree.ts` keeps the engine demo fixtures and
 * the reworks author their skins in-package, so the shared `Tree` system
 * (procedural bark + layered alpha-card canopy, WIND_CLOCK vertex sway)
 * renders CLOUDS-authored pigments, never the engine demo's.
 *
 * The engine's own 'clouds' demo skin (pale drifted bark, sea-greens, white
 * bloom) is the palette REFERENCE both varieties derive from:
 *
 *  - sky-garden — the summit and gate isles' tended variety: drifted
 *    limestone bark, bright sea-green crowns carrying a white bloom pass
 *    (the high-altitude flowering the frames read as sky-garden blossoms).
 *  - grove — the wild leeward groves on the register/aces/fixtures isles:
 *    storm-darkened bark, deeper pine-tinted sea-greens, bloomless.
 *
 * Pure pigment data — consumed by `useTreeSkinMaterials(skin)` (one per
 * skin) which paints the cards through `tree-cards.ts`; NO texture files,
 * NO mmx output, and the `public/textures/world/` bake-of-record PNGs are
 * untouched (their byte-equality test pins the engine demo skin's cards).
 */

const SKY_GARDEN_BARK = {
  base: { r: 152, g: 146, b: 130 },
  ridge: { r: 178, g: 172, b: 152 },
  fissure: { r: 112, g: 106, b: 92 },
} as const;

const GROVE_BARK = {
  base: { r: 118, g: 110, b: 96 },
  ridge: { r: 146, g: 138, b: 118 },
  fissure: { r: 82, g: 76, b: 64 },
} as const;

/** The tended sky-garden variety: bright crowns, white bloom pass. */
export const CLOUDS_SKY_GARDEN_SKIN: TreeSkin = {
  id: 'clouds-sky-garden',
  bark: SKY_GARDEN_BARK,
  leafA: {
    base: { r: 120, g: 172, b: 154 },
    lit: { r: 156, g: 202, b: 180 },
    shadow: { r: 84, g: 130, b: 118 },
    bloom: { r: 238, g: 246, b: 240 },
    bloomShare: 0.26,
  },
  leafB: {
    base: { r: 100, g: 154, b: 142 },
    lit: { r: 134, g: 186, b: 168 },
    shadow: { r: 68, g: 110, b: 102 },
    bloom: { r: 224, g: 238, b: 228 },
    bloomShare: 0.12,
  },
  cardScaleM: 1.6,
};

/** The wild grove variety: darker bark, deep sea-green crowns, no bloom. */
export const CLOUDS_GROVE_SKIN: TreeSkin = {
  id: 'clouds-grove',
  bark: GROVE_BARK,
  leafA: {
    base: { r: 88, g: 138, b: 128 },
    lit: { r: 118, g: 168, b: 152 },
    shadow: { r: 58, g: 98, b: 92 },
    bloom: null,
    bloomShare: 0,
  },
  leafB: {
    base: { r: 72, g: 118, b: 112 },
    lit: { r: 100, g: 148, b: 136 },
    shadow: { r: 46, g: 82, b: 78 },
    bloom: null,
    bloomShare: 0,
  },
  cardScaleM: 1.6,
};
