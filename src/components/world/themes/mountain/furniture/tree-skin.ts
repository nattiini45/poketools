import type { TreeSkin } from '@/lib/route-world/tree';

/**
 * The rework's own TreeSkin DATA (C-103 criterion 2). `tree.ts` sanctions
 * exactly this path: the reworks (C-102..104) author their skins in-package
 * while the engine keeps its demo fixtures — so the shared `Tree` system
 * (procedural bark + layered leaf cards, WIND_CLOCK vertex sway) renders
 * MOUNTAIN-authored pigments. The engine's 'mountain' demo skin (grey-brown
 * conifer bark, deep pine greens, bloom 0.08) is the reference these evolve,
 * never the shipped pigment set.
 *
 * Pure pigment data — consumed by `useTreeSkinMaterials(skin)` (one per
 * skin) which paints the cards through `tree-cards.ts`; NO texture files,
 * NO mmx output, and the `public/textures/world/` bake-of-record PNGs are
 * untouched (their byte-equality test pins the engine demo skin's cards).
 */

/** Cold spruce bark: grey-brown with a frost-paled ridge crest. */
const CONIFER_BARK = {
  base: { r: 74, g: 68, b: 58 },
  ridge: { r: 104, g: 100, b: 88 },
  fissure: { r: 42, g: 39, b: 34 },
} as const;

/**
 * The conifer skin: two deep spruce/pine sets, the B set carrying a WHITE
 * SNOW bloom pass — the high-band crowns read as snow-dusted, the pass's
 * own vocabulary (the summit crag's snowline, in the trees).
 */
export const MOUNTAIN_CONIFER_SKIN: TreeSkin = {
  id: 'mountain-conifer',
  bark: CONIFER_BARK,
  leafA: {
    base: { r: 46, g: 84, b: 56 },
    lit: { r: 70, g: 112, b: 72 },
    shadow: { r: 27, g: 54, b: 40 },
    bloom: null,
    bloomShare: 0,
  },
  leafB: {
    base: { r: 36, g: 70, b: 52 },
    lit: { r: 60, g: 96, b: 68 },
    shadow: { r: 21, g: 44, b: 34 },
    bloom: { r: 214, g: 226, b: 224 },
    bloomShare: 0.14,
  },
  cardScaleM: 1.8,
};

/**
 * The alpine variety: the subalpine meadow's ash/aspen line — greyer bark
 * and cooler sage foliage so the treeline is not monochrome; a faint pale
 * bloom reads as sun catching the leaf faces.
 */
export const MOUNTAIN_ALPINE_SKIN: TreeSkin = {
  id: 'mountain-alpine',
  bark: {
    base: { r: 98, g: 92, b: 80 },
    ridge: { r: 128, g: 122, b: 106 },
    fissure: { r: 60, g: 55, b: 47 },
  },
  leafA: {
    base: { r: 92, g: 116, b: 74 },
    lit: { r: 122, g: 148, b: 96 },
    shadow: { r: 58, g: 78, b: 50 },
    bloom: { r: 208, g: 220, b: 186 },
    bloomShare: 0.1,
  },
  leafB: {
    base: { r: 74, g: 98, b: 66 },
    lit: { r: 102, g: 128, b: 86 },
    shadow: { r: 46, g: 64, b: 42 },
    bloom: null,
    bloomShare: 0,
  },
  cardScaleM: 1.7,
};
