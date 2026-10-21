import type { TreeSkin } from '@/lib/route-world/tree';

/**
 * The rework's own TreeSkin DATA (C-102 criterion 2). `tree.ts` sanctions
 * exactly this path: the reworks (C-102..104) author their skins in-package
 * while the engine keeps its demo fixtures — so the shared `Tree` system
 * (procedural bark + layered blossom leaf cards, WIND_CLOCK vertex sway)
 * renders SAKURA-authored pigments, never the engine demo's.
 *
 * Pure pigment data — consumed by `useTreeSkinMaterials(skin)` (one per
 * skin) which paints the cards through `tree-cards.ts`; NO texture files,
 * NO mmx output, and the `public/textures/world/` bake-of-record PNGs are
 * untouched (their byte-equality test pins the engine demo skin's cards).
 */

/** Dark cherry bark with a warm ridge crest — grander than the demo's. */
const CHERRY_BARK = {
  base: { r: 66, g: 50, b: 46 },
  ridge: { r: 92, g: 72, b: 66 },
  fissure: { r: 40, g: 30, b: 28 },
} as const;

/** The blossom skin: two pink cluster sets with a white bloom pass. */
export const SAKURA_CHERRY_SKIN: TreeSkin = {
  id: 'sakura-cherry',
  bark: CHERRY_BARK,
  leafA: {
    base: { r: 243, g: 196, b: 214 },
    lit: { r: 251, g: 216, b: 228 },
    shadow: { r: 214, g: 142, b: 174 },
    bloom: { r: 253, g: 231, b: 240 },
    bloomShare: 0.36,
  },
  leafB: {
    base: { r: 228, g: 158, b: 192 },
    lit: { r: 245, g: 192, b: 214 },
    shadow: { r: 184, g: 104, b: 146 },
    bloom: { r: 250, g: 216, b: 230 },
    bloomShare: 0.44,
  },
  cardScaleM: 1.7,
};

/** The park variety: spring-green crowns so the ring is not monochrome. */
export const SAKURA_PARK_SKIN: TreeSkin = {
  id: 'sakura-park',
  bark: {
    base: { r: 96, g: 86, b: 74 },
    ridge: { r: 122, g: 110, b: 92 },
    fissure: { r: 58, g: 50, b: 42 },
  },
  leafA: {
    base: { r: 118, g: 158, b: 96 },
    lit: { r: 150, g: 190, b: 120 },
    shadow: { r: 74, g: 102, b: 62 },
    bloom: { r: 214, g: 228, b: 186 },
    bloomShare: 0.1,
  },
  leafB: {
    base: { r: 88, g: 124, b: 72 },
    lit: { r: 118, g: 156, b: 94 },
    shadow: { r: 54, g: 80, b: 46 },
    bloom: null,
    bloomShare: 0,
  },
  cardScaleM: 1.6,
};
