/**
 * Shared tree system (C-100 criterion 3) — the pure geometry + gating half.
 *
 * A tree is REAL structure, not a billboard: a tapered trunk, recursive
 * branch segments built as geometry, and a layered alpha-card canopy (the
 * per-theme leaf-card sets are DATA — `TreeSkin`, painted procedurally by
 * `tree-cards.ts`). Density tiers gate off the engine QUALITY_LADDER
 * (`quality.ts` rungs, 0=TOP → 4=bottom), and distant trees cull by
 * camera distance. Deterministic per seed, so a capture run renders the
 * same forest twice.
 *
 * Pure math — no client-only imports, unit-testable in node. The React
 * mounter lives at `src/components/world/route/trees/Tree.tsx`.
 */

import type { BufferGeometry } from 'three';

/** Deterministic 32-bit PRNG (mulberry32) — same seed, same tree. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** One leaf-card set's pigment: base foliage with lit/shadow variation and an optional blossom pass. */
export interface LeafPalette {
  base: Rgb;
  lit: Rgb;
  shadow: Rgb;
  /** Optional secondary bloom colour (sakura blossom, isle flowers). */
  bloom: Rgb | null;
  /** Share of leaf area the bloom pass claims, when `bloom` is set. */
  bloomShare: number;
}

/** Bark pigment: ridge crest, fissure depth, base wood between them. */
export interface BarkPalette {
  base: Rgb;
  ridge: Rgb;
  fissure: Rgb;
}

/** A theme's leaf-card data: TWO distinct cluster sets, per the bar. */
export interface TreeSkin {
  id: string;
  bark: BarkPalette;
  leafA: LeafPalette;
  leafB: LeafPalette;
  /** Canopy card footprint (metres) at scale 1. */
  cardScaleM: number;
  /**
   * Canopy render path (LOOK-PLAN §2 SEAT M item 2). Absent or `'cards'`:
   * the C-100 per-card meshes, density by regrowing the structure per rung
   * (sakura, mountain, clouds — unchanged). `'painted'`: the plaza's brushy
   * canopy — one merged, importance-sorted card geometry per tree with
   * spherical normals, vertex AO and back-light translucency, density by
   * `setDrawRange` so a quality step never uploads (see `Tree.tsx`).
   */
  canopy?: TreeCanopyMode;
  /**
   * ROLLOUT §2.2 (h), painted skins only: the translucent EDGE hue of the
   * canopy (`CANOPY_EDGE_PRESETS` in `tree-cards.ts`). Absent = `linden-gold`
   * (the plaza's gold, program key `tree-canopy-painted-v4`); any other
   * preset keys `tree-canopy-painted-v4|edge:<id>`.
   */
  canopyEdge?: CanopyEdgePreset;
  /**
   * ROLLOUT §2.2 (h), painted skins only: a crown builder the shared
   * `PaintedTree` calls INSTEAD of the spherical card crown (mountain's
   * conifer crown lives in the mountain folder; no world edits
   * `tree-cards.ts`). The build always runs through the sliced paint queue.
   */
  paintedCrown?: PaintedCrownBuilder;
}

export type TreeCanopyMode = 'cards' | 'painted';

/** The painted canopy's edge-hue presets (the GLSL values live in `tree-cards.ts`). */
export type CanopyEdgePreset = 'linden-gold' | 'blossom-peach' | 'aspen-gold';

/** What a crown builder receives: the planned tree and the shared canopy context. */
export interface PaintedCrownInput {
  /** The planned tree (structure grown once at rung-0 density; importance-sorted cards). */
  plan: PaintedCanopyPlan;
  skin: TreeSkin;
  /** The card-crown sphere (tree-local) the default build uses. */
  crown: { center: Vec3; radius: number };
  /** Lamp proximity of a tree-LOCAL point (0..1); absent = no lamps. */
  lampAt?: (x: number, y: number, z: number) => number;
}

/**
 * A built crown: ONE indexed geometry carrying exactly the painted canopy's
 * attribute set (`position`, `normal`, `uv`, `color` (rgb), `aSway`,
 * `aPhase`, `aLamp`, one group over the index), so it shares the canopy
 * program; and the index count drawn at a quality rung (monotone
 * non-increasing), so a governor step only moves the draw range.
 */
export interface PaintedCrown {
  geometry: BufferGeometry;
  drawCount: (rung: number) => number;
}

export type PaintedCrownBuilder = (input: PaintedCrownInput) => PaintedCrown;

/** The render path a skin selects (default `'cards'`). */
export function canopyModeFor(skin: Pick<TreeSkin, 'canopy'>): TreeCanopyMode {
  return skin.canopy === 'painted' ? 'painted' : 'cards';
}

/**
 * The three demo skins of record (C-100 stills cite one tree per skin):
 * sakura — dark cherry bark, two blossom pinks; mountain — grey-brown
 * conifer bark, deep pine greens; clouds — pale drifted bark, sea-greens
 * with a white bloom. Engine-owned DATA (probe/demo fixtures), not theme
 * package content — the reworks (C-102..104) author their own skins.
 */
export const TREE_SKINS: readonly TreeSkin[] = [
  {
    id: 'sakura',
    bark: { base: { r: 74, g: 58, b: 54 }, ridge: { r: 96, g: 76, b: 70 }, fissure: { r: 46, g: 35, b: 33 } },
    leafA: { base: { r: 236, g: 168, b: 196 }, lit: { r: 248, g: 198, b: 218 }, shadow: { r: 196, g: 120, b: 158 }, bloom: { r: 252, g: 226, b: 236 }, bloomShare: 0.34 },
    leafB: { base: { r: 222, g: 148, b: 184 }, lit: { r: 240, g: 184, b: 208 }, shadow: { r: 172, g: 96, b: 138 }, bloom: { r: 250, g: 214, b: 228 }, bloomShare: 0.42 },
    cardScaleM: 1.7,
  },
  {
    id: 'mountain',
    bark: { base: { r: 88, g: 78, b: 66 }, ridge: { r: 112, g: 100, b: 84 }, fissure: { r: 54, g: 47, b: 40 } },
    leafA: { base: { r: 52, g: 92, b: 60 }, lit: { r: 78, g: 118, b: 74 }, shadow: { r: 32, g: 62, b: 44 }, bloom: null, bloomShare: 0 },
    leafB: { base: { r: 40, g: 74, b: 52 }, lit: { r: 64, g: 100, b: 68 }, shadow: { r: 24, g: 48, b: 34 }, bloom: { r: 178, g: 196, b: 158 }, bloomShare: 0.08 },
    cardScaleM: 1.9,
  },
  {
    id: 'clouds',
    bark: { base: { r: 148, g: 142, b: 128 }, ridge: { r: 174, g: 168, b: 150 }, fissure: { r: 110, g: 104, b: 92 } },
    leafA: { base: { r: 116, g: 168, b: 152 }, lit: { r: 150, g: 198, b: 178 }, shadow: { r: 82, g: 128, b: 118 }, bloom: { r: 236, g: 244, b: 238 }, bloomShare: 0.22 },
    leafB: { base: { r: 96, g: 150, b: 140 }, lit: { r: 130, g: 182, b: 166 }, shadow: { r: 66, g: 108, b: 102 }, bloom: null, bloomShare: 0 },
    cardScaleM: 1.6,
  },
] as const;

export type TreeSkinId = (typeof TREE_SKINS)[number]['id'];

export function treeSkinById(id: string): TreeSkin {
  const skin = TREE_SKINS.find((candidate) => candidate.id === id);
  if (!skin) throw new Error(`[route-world] unknown tree skin "${id}"`);
  return skin;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One trunk/branch segment: a tapered cylinder from `from` to `to`. */
export interface BranchSegment {
  from: Vec3;
  to: Vec3;
  /** Cylinder radius at `from` and `to`, in metres. */
  radiusFrom: number;
  radiusTo: number;
  /** 0 = trunk, 1 = primary limb, 2 = secondary twig. */
  level: 0 | 1 | 2;
}

/** One alpha-card canopy placement. */
export interface CanopyCard {
  position: Vec3;
  /** Yaw around Y and tilt off vertical, radians. */
  yaw: number;
  tilt: number;
  scale: number;
  /** 0 = lowest canopy layer, ascending. */
  layer: number;
  /** Which leaf-card set of the skin this card shows. */
  set: 'A' | 'B';
  /** Per-card wind phase so cards never breathe in lockstep. */
  swayPhase: number;
}

export interface TreeStructure {
  trunk: BranchSegment;
  branches: BranchSegment[];
  cards: CanopyCard[];
  /** Authored crown height in metres (the trunk's top). */
  heightM: number;
}

export interface TreeSpec {
  skin: TreeSkin;
  /** Crown height in metres. */
  heightM: number;
  seed: number;
}

/** Full-density tree shape: branch budget and card budget per layer. */
const FULL_SHAPE = {
  primaryBranches: 5,
  twigsPerBranch: 3,
  cardsPerLayer: 5,
  layers: 3,
} as const;

/**
 * Density tier per QUALITY_LADDER rung (0=TOP → 4=bottom, quality.ts:116).
 * Monotone by construction: higher rung, fewer cards and shallower branch
 * recursion — rung 4 keeps ONE card layer so a tree reads as a tree at the
 * bottom rung rather than vanishing.
 */
export function treeDensityForRung(rung: number): { branchLevels: 3 | 2 | 1; cardsPerLayer: number; layers: number } {
  const r = Math.max(0, Math.min(4, Math.floor(rung)));
  switch (r) {
    case 0:
      return { branchLevels: 3, cardsPerLayer: FULL_SHAPE.cardsPerLayer, layers: FULL_SHAPE.layers };
    case 1:
      return { branchLevels: 3, cardsPerLayer: 4, layers: 3 };
    case 2:
      return { branchLevels: 2, cardsPerLayer: 4, layers: 2 };
    case 3:
      return { branchLevels: 2, cardsPerLayer: 3, layers: 2 };
    default:
      // The bottom rung keeps trunk + primary limbs and ONE card layer, so a
      // tree still reads as a tree at the lowest quality rather than a stick.
      return { branchLevels: 2, cardsPerLayer: 2, layers: 1 };
  }
}

/** Grow one deterministic tree: trunk, primary limbs, twigs, layered canopy cards. */
export function growTree(spec: TreeSpec): TreeStructure {
  const rand = mulberry32(spec.seed);
  const h = spec.heightM;
  // Slight authored lean so no two trees stand perfectly plumb.
  const leanX = (rand() - 0.5) * 0.12 * h;
  const leanZ = (rand() - 0.5) * 0.12 * h;
  const trunkTop: Vec3 = { x: leanX, y: h, z: leanZ };
  const trunk: BranchSegment = {
    from: { x: 0, y: 0, z: 0 },
    to: trunkTop,
    radiusFrom: Math.max(0.07, h * 0.045),
    radiusTo: Math.max(0.03, h * 0.018),
    level: 0,
  };

  const branches: BranchSegment[] = [];
  const cards: CanopyCard[] = [];

  for (let i = 0; i < FULL_SHAPE.primaryBranches; i += 1) {
    const azimuth = (i / FULL_SHAPE.primaryBranches) * Math.PI * 2 + rand() * 0.8;
    const fromFrac = 0.55 + rand() * 0.35;
    const from: Vec3 = { x: leanX * fromFrac, y: h * fromFrac, z: leanZ * fromFrac };
    const reach = h * (0.22 + rand() * 0.14);
    const rise = h * (0.1 + rand() * 0.16);
    const to: Vec3 = {
      x: from.x + Math.cos(azimuth) * reach,
      y: from.y + rise,
      z: from.z + Math.sin(azimuth) * reach,
    };
    const limb: BranchSegment = {
      from,
      to,
      radiusFrom: trunk.radiusTo * (0.8 + rand() * 0.3),
      radiusTo: trunk.radiusTo * 0.45,
      level: 1,
    };
    branches.push(limb);
    // Twigs fan off each limb's outer half; their tips seed the canopy.
    const twigTips: Vec3[] = [];
    for (let t = 0; t < FULL_SHAPE.twigsPerBranch; t += 1) {
      const frac = 0.45 + (t / FULL_SHAPE.twigsPerBranch) * 0.5;
      const base: Vec3 = {
        x: from.x + (to.x - from.x) * frac,
        y: from.y + (to.y - from.y) * frac,
        z: from.z + (to.z - from.z) * frac,
      };
      const twigAz = azimuth + (rand() - 0.5) * 1.6;
      const tip: Vec3 = {
        x: base.x + Math.cos(twigAz) * reach * 0.45,
        y: base.y + rise * (0.3 + rand() * 0.5),
        z: base.z + Math.sin(twigAz) * reach * 0.45,
      };
      branches.push({
        from: base,
        to: tip,
        radiusFrom: limb.radiusTo * 0.6,
        radiusTo: limb.radiusTo * 0.25,
        level: 2,
      });
      twigTips.push(tip);
    }
    // Canopy cards cluster over the limb and its twig tips, in layers.
    for (let layer = 0; layer < FULL_SHAPE.layers; layer += 1) {
      for (let c = 0; c < FULL_SHAPE.cardsPerLayer; c += 1) {
        const anchor = c % 2 === 0 ? to : twigTips[c % twigTips.length];
        cards.push({
          position: {
            x: anchor.x + (rand() - 0.5) * spec.skin.cardScaleM * 0.9,
            y: anchor.y + layer * h * 0.09 + rand() * h * 0.05,
            z: anchor.z + (rand() - 0.5) * spec.skin.cardScaleM * 0.9,
          },
          yaw: rand() * Math.PI * 2,
          tilt: (rand() - 0.5) * 0.7,
          scale: 0.8 + rand() * 0.5,
          layer,
          set: (i + layer + c) % 2 === 0 ? 'A' : 'B',
          swayPhase: rand() * Math.PI * 2,
        });
      }
    }
  }

  return { trunk, branches, cards, heightM: h };
}

/**
 * Prune a grown tree to a density tier, deterministically: keep every
 * k-th branch/card by index (k = ceil(kept/total)) so the SAME tree thins
 * the same way every render — never a different random subset.
 */
export function applyTreeDensity(tree: TreeStructure, density: ReturnType<typeof treeDensityForRung>): TreeStructure {
  const maxLevel = density.branchLevels - 1;
  const branches = tree.branches.filter((branch) => branch.level <= maxLevel);
  const cardBudget = density.cardsPerLayer * density.layers * Math.max(1, Math.round(tree.cards.length / (FULL_SHAPE.layers * FULL_SHAPE.cardsPerLayer * FULL_SHAPE.primaryBranches)));
  const step = Math.max(1, Math.ceil(tree.cards.length / Math.max(1, cardBudget)));
  const cards = tree.cards.filter((_, i) => i % step === 0).slice(0, cardBudget);
  return { ...tree, branches, cards };
}

/** Beyond this distance from the camera (metres, horizontal) a tree culls. */
export const TREE_CULL_RADIUS_M = 55;

/** Distance culling: horizontal camera distance against the shared radius. */
export function isTreeCulled(
  tree: { readonly x: number; readonly z: number },
  camera: { readonly x: number; readonly z: number },
  radiusM: number = TREE_CULL_RADIUS_M,
): boolean {
  return Math.hypot(tree.x - camera.x, tree.z - camera.z) > radiusM;
}

/**
 * The crown as a sphere in the tree's LOCAL frame (before the placement's
 * yaw): the centroid of the card centres and the radius that reaches every
 * card centre plus half a card. Placement code (the rules shafts threading a
 * canopy) turns it into world space with `crownSphereAt`.
 */
export function crownSphere(tree: TreeStructure, cardScaleM: number): { center: Vec3; radius: number } {
  if (tree.cards.length === 0) return { center: { ...tree.trunk.to }, radius: 0 };
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const card of tree.cards) {
    cx += card.position.x;
    cy += card.position.y;
    cz += card.position.z;
  }
  const n = tree.cards.length;
  const center = { x: cx / n, y: cy / n, z: cz / n };
  let radius = 0;
  for (const card of tree.cards) {
    const d = Math.hypot(card.position.x - center.x, card.position.y - center.y, card.position.z - center.z);
    radius = Math.max(radius, d + (card.scale * cardScaleM) / 2);
  }
  return { center, radius };
}

/** A local crown sphere placed at `base` turned by `yaw` about +Y (three's rotation convention). */
export function crownSphereAt(
  crown: { center: Vec3; radius: number },
  base: readonly [number, number, number],
  yaw: number,
): { center: [number, number, number]; radius: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const { x, y, z } = crown.center;
  return { center: [base[0] + x * c + z * s, base[1] + y, base[2] - x * s + z * c], radius: crown.radius };
}

// ── Painted canopy (plaza skin, LOOK-PLAN §2 SEAT M item 2) ─────────────────

/** Index entries per canopy card (two triangles). */
export const CANOPY_INDICES_PER_CARD = 6;

/** Rungs of the QUALITY_LADDER the painted canopy precomputes a card count for. */
const CANOPY_RUNGS = [0, 1, 2, 3, 4] as const;

export interface PaintedCanopyPlan {
  /**
   * The structure grown ONCE at rung-0 density: every branch level, the
   * rung-0 card set. It never regrows — a quality step only moves the draw
   * range, so a governor step uploads nothing (the `applyTreeDensity`
   * regrow was a D23 hole: new geometry after reveal).
   */
  structure: TreeStructure;
  /** `structure.cards` in importance order: the first N cards are the rung's canopy. */
  cards: CanopyCard[];
  /** Cards drawn per rung (index = rung), monotone non-increasing, ≥ 1. */
  cardsPerRung: readonly number[];
}

/** Golden-ratio spread rank: 0, 2, 4, 1, 3 … over `n` items, deterministic. */
function spreadOrder(n: number): number[] {
  const phi = 0.6180339887498949;
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => ((a * phi) % 1) - ((b * phi) % 1) || a - b);
}

/**
 * Importance order for the draw range: round-robin over the layers (so every
 * density keeps the crown's full height), and within a layer a golden-ratio
 * spread over azimuth (so a thinned crown stays round instead of losing one
 * side). Stable and deterministic.
 */
export function canopyImportanceOrder(cards: readonly CanopyCard[]): CanopyCard[] {
  const layers = [...new Set(cards.map((card) => card.layer))].sort((a, b) => a - b);
  const ranked = layers.map((layer) => {
    const inLayer = cards
      .filter((card) => card.layer === layer)
      .map((card) => ({ card, azimuth: Math.atan2(card.position.z, card.position.x) }))
      .sort((a, b) => a.azimuth - b.azimuth)
      .map((entry) => entry.card);
    return spreadOrder(inLayer.length).map((i) => inLayer[i]);
  });
  const out: CanopyCard[] = [];
  const depth = Math.max(0, ...ranked.map((list) => list.length));
  for (let rank = 0; rank < depth; rank += 1) {
    for (const list of ranked) if (rank < list.length) out.push(list[rank]);
  }
  return out;
}

/**
 * Plan a painted canopy: grow once at rung-0 density, sort by importance, and
 * fix each rung's card count to the count the C-100 density tiers give (never
 * above rung 0's, never below one card).
 */
export function planPaintedCanopy(spec: TreeSpec): PaintedCanopyPlan {
  const full = growTree(spec);
  const structure = applyTreeDensity(full, treeDensityForRung(0));
  // Every branch level stays: the bark is a handful of static cylinders and
  // keeping them constant means the bark never changes on a step either.
  structure.branches = full.branches;
  const cards = canopyImportanceOrder(structure.cards);
  const cardsPerRung: number[] = [];
  for (const rung of CANOPY_RUNGS) {
    const tier = applyTreeDensity(full, treeDensityForRung(rung)).cards.length;
    const previous = cardsPerRung.length > 0 ? cardsPerRung[cardsPerRung.length - 1] : cards.length;
    cardsPerRung.push(Math.max(Math.min(1, cards.length), Math.min(tier, previous, cards.length)));
  }
  return { structure: { ...structure, cards }, cards, cardsPerRung };
}

/** Cards drawn at a rung (out-of-ladder rungs clamp into range). */
export function paintedCanopyCards(plan: Pick<PaintedCanopyPlan, 'cardsPerRung'>, rung: number): number {
  const r = Math.max(0, Math.min(plan.cardsPerRung.length - 1, Math.floor(Number.isFinite(rung) ? rung : 0)));
  return plan.cardsPerRung[r];
}

/** The index draw range (start 0) of a rung. */
export function paintedCanopyDrawCount(plan: Pick<PaintedCanopyPlan, 'cardsPerRung'>, rung: number): number {
  return paintedCanopyCards(plan, rung) * CANOPY_INDICES_PER_CARD;
}
