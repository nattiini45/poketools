'use client';

import * as THREE from 'three';
import type { BarkPalette, CanopyEdgePreset, LeafPalette } from '@/lib/route-world/tree';

/**
 * Procedural bark + leaf-cluster card painters (C-100 criterion 3).
 *
 * The repo's authored-texture idiom (plaza `stone-maps.ts`): pure pixel
 * fields computed into a RGBA `Uint8Array` — deterministic, seeded, no
 * canvas API, no AI generation, no image files to hand-maintain. The same
 * arrays feed the runtime `DataTexture`s AND the baked PNGs under
 * `public/textures/world/` (the bake of record lives in
 * `__tests__/tree-cards.bake.test.ts`), so the shipped cards and the
 * rendered cards are the same pixels by construction.
 *
 * ALPHA SEAM LAW: a rectangular card silhouette is baked out in
 * the PAINT, not in the material — leaf coverage tapers to a low crest
 * toward the card edge, and a destination-in-equivalent alpha fade multiplies
 * the whole outer zone so alpha reaches 0 well inside the border. The
 * alphaTest cut therefore sits inside the tapered zone: no straight edge, no
 * rectangular halo, at any viewing aspect.
 */

export const BARK_CARD_SIZE = 256;
export const LEAF_CARD_SIZE = 256;

/** The alphaTest threshold the runtime cards are cut with. */
export const LEAF_ALPHA_TEST = 0.5;

/** Stable integer seed for a skin id — paint is deterministic per skin, and the runtime and the bake share it. */
export function skinSeed(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Border fraction where the alpha fade completes (alpha exactly 0 at the rim). */
const EDGE_FADE_START = 0.82;

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Stable hash noise in [0,1) — the stone-maps hash2, reused verbatim. */
function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668262263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Bark card: vertical ridges with wandering warp, fissures in the lows,
 * grain noise over everything. Fully opaque — bark rides geometry UVs.
 */
export function paintBarkCardData(bark: BarkPalette, seed: number, size: number = BARK_CARD_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Ridge field: triangle wave over a warped column coordinate, so the
      // ridges wander vertically instead of reading as straight stripes.
      const warp = (valueNoise(x * 0.03 + seed * 0.11, y * 0.012) - 0.5) * 9;
      const ridgePhase = ((x + warp) / size) * 9;
      const ridgeTri = Math.abs(((ridgePhase % 1) + 1) % 1 - 0.5) * 2;
      const crest = smoothstep(0.45, 0.95, ridgeTri);
      const fissure = smoothstep(0.4, 0.05, ridgeTri);
      const grain = (valueNoise(x * 0.35, y * 0.09 + seed) - 0.5) * 18;
      const o = (y * size + x) * 4;
      data[o] = clamp255(bark.base.r + crest * (bark.ridge.r - bark.base.r) - fissure * (bark.base.r - bark.fissure.r) + grain);
      data[o + 1] = clamp255(bark.base.g + crest * (bark.ridge.g - bark.base.g) - fissure * (bark.base.g - bark.fissure.g) + grain * 0.8);
      data[o + 2] = clamp255(bark.base.b + crest * (bark.ridge.b - bark.base.b) - fissure * (bark.base.b - bark.fissure.b) + grain * 0.6);
      data[o + 3] = 255;
    }
  }
  return data;
}

/** One leaf-cluster blob seeded per card. */
interface LeafBlob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  tone: 'lit' | 'base' | 'shadow';
  bloom: boolean;
}

function leafBlobs(set: 'A' | 'B', seed: number): LeafBlob[] {
  const rand = (i: number, salt: number): number => hash2(seed * 31 + i, salt * 17 + (set === 'A' ? 0 : 977));
  const count = set === 'A' ? 22 : 30;
  const blobs: LeafBlob[] = [];
  for (let i = 0; i < count; i += 1) {
    // Radial push toward the center: coverage tapers to a low crest near
    // the rim — the first half of the seam bake.
    const angle = rand(i, 1) * Math.PI * 2;
    const radial = Math.sqrt(rand(i, 2)) * 0.62;
    const stretch = set === 'A' ? 1 : 1.9;
    blobs.push({
      cx: 0.5 + Math.cos(angle) * radial,
      cy: 0.5 + Math.sin(angle) * radial,
      rx: (set === 'A' ? 0.16 : 0.24) * (0.6 + rand(i, 3) * 0.7),
      ry: (set === 'A' ? 0.16 : 0.24) * (0.6 + rand(i, 4) * 0.7) / stretch,
      rot: angle + (rand(i, 5) - 0.5) * 1.2,
      tone: rand(i, 6) < 0.3 ? 'lit' : rand(i, 6) > 0.78 ? 'shadow' : 'base',
      bloom: false,
    });
  }
  return blobs;
}

/**
 * Leaf-cluster card: overlapping leaf blobs, per-blob tone (lit tops,
 * shadowed undersides), optional bloom pass — alpha TAPERED to a low crest
 * at the blob fringe and FADED to zero inside the border zone, so the
 * alphaTest cut sits in the fade, never on a rectangle edge.
 */
export function paintLeafCardData(
  leaf: LeafPalette,
  set: 'A' | 'B',
  seed: number,
  size: number = LEAF_CARD_SIZE,
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const blobs = leafBlobs(set, seed);
  const bloomBlobs = leaf.bloom
    ? blobs.filter((_, i) => hash2(seed + i, 4242) < leaf.bloomShare)
    : [];
  const bloomSet = new Set(bloomBlobs);
  // ENGINE r3 (load long task, 0.66 s on dev for the plaza's two skins):
  // the per-blob rotation is hoisted out of the pixel loop, and a pixel
  // outside a blob's bounding circle skips it. Pixel-identical: the same
  // cos/sin values feed the same expressions, and a point inside the
  // ellipse (d < 1) always lies within max(rx, ry) of its centre (the
  // 1e-4 pad keeps float rounding from ever flipping that test).
  const cosOf = blobs.map((blob) => Math.cos(blob.rot));
  const sinOf = blobs.map((blob) => Math.sin(blob.rot));
  const reach2Of = blobs.map((blob) => {
    const reach = Math.max(blob.rx, blob.ry) * 1.0001;
    return reach * reach;
  });

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let coverage = 0;
      let litness = 0;
      let bloomHit = false;
      for (let i = 0; i < blobs.length; i += 1) {
        const blob = blobs[i];
        const dx = u - blob.cx;
        const dy = v - blob.cy;
        if (dx * dx + dy * dy > reach2Of[i]) continue;
        const cos = cosOf[i];
        const sin = sinOf[i];
        const bx = (dx * cos + dy * sin) / blob.rx;
        const by = (-dx * sin + dy * cos) / blob.ry;
        const d = Math.sqrt(bx * bx + by * by);
        if (d < 1) {
          // Tapered fringe: full tone inside, feathered to the crest. The
          // topmost member decides tone and bloom.
          const member = smoothstep(1, 0.62, d);
          if (member > coverage) {
            coverage = member;
            litness = blob.tone === 'lit' ? 1 : blob.tone === 'shadow' ? -1 : 0;
            bloomHit = bloomSet.has(blob);
          }
        }
      }

      // Destination-in-equivalent edge fade: radial mask reaching 0 at the
      // rim so alpha never meets the texture border with weight.
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const edgeFade = 1 - smoothstep(EDGE_FADE_START, 1.0, r);
      const alpha = clamp255(coverage * edgeFade * 255);
      const o = (y * size + x) * 4;
      const tone = bloomHit && leaf.bloom ? leaf.bloom : litness > 0 ? leaf.lit : litness < 0 ? leaf.shadow : leaf.base;
      data[o] = clamp255(tone.r);
      data[o + 1] = clamp255(tone.g);
      data[o + 2] = clamp255(tone.b);
      data[o + 3] = alpha;
    }
  }
  return data;
}

/**
 * Card pixels → `DataTexture`. Rows are flipped because a DataTexture
 * samples v=0 at row 0 while the card plane's v=0 is its bottom edge
 * (the same flip every canvas-to-DataTexture copy needs). Callers own disposal.
 */
export function cardDataTexture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const flipped = new Uint8Array(data.length);
  const row = size * 4;
  for (let y = 0; y < size; y += 1) {
    flipped.set(data.subarray((size - 1 - y) * row, (size - 1 - y) * row + row), y * row);
  }
  const tex = new THREE.DataTexture(flipped, size, size);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ── Painted canopy (plaza skin, LOOK-PLAN §2 SEAT M item 2) ─────────────────
//
// Everything below is used ONLY by skins with `canopy: 'painted'` (the plaza
// linden and plane). The C-100 card path above and in `Tree.tsx` is untouched,
// so sakura, mountain and clouds keep their programs and pixels.

/** Share of the radial (crown-sphere) direction in a canopy vertex normal. */
export const CANOPY_RADIAL_NORMAL = 0.7;

/** Vertex AO: crown core → rim. */
export const CANOPY_AO = { core: 0.55, rim: 1.0 } as const;

/** Back-light translucency ceiling, linear radiance per channel. */
export const LEAF_SSS_CLAMP = 1.2;

/** Translucency strength per palette (uniform writes only). */
export const LEAF_SSS_LEVELS = { day: 1.5, night: 0.05 } as const;

/**
 * LOOK r4 (rules: "no backlit canopy glow"): the translucency lobe is
 * broadened from back⁴ to back² · (0.35 + 0.65 back²), so a crown 40–55° off
 * the sun axis (the rules pose) already glows, not only one dead ahead.
 */
export const LEAF_SSS_LOBE_FLOOR = 0.35;


/**
 * The shared translucency strength (module scope, like the wind clock: one
 * key light per world). The plaza's `Trees.tsx` writes it per palette.
 */
export const LEAF_SSS: { value: number } = { value: LEAF_SSS_LEVELS.day };

/**
 * LOOK r6 (L4b, rules: "yellow-lit canopies that look sickly / chartreuse"):
 * the transmitted light's hue no longer follows the (green) albedo — toward
 * thin fringes and the crown rim it turns to a painter's GOLD, R > G on
 * purpose so AgX's yellow skew lands on gold, never chartreuse:
 * `mix(albedo · body, gold · max(lum, lumFloor) · gain, saturate(0.35 + 0.65 · max(thin, rim)))`.
 */
export const LEAF_GOLD = {
  body: [1.35, 1.0, 0.55] as const,
  gold: [1.0, 0.62, 0.22] as const,
  lumFloor: 0.18,
  gain: 2.2,
} as const;

/**
 * LOOK r6 (L4b): the contre-jour silhouette — a dark, cool crown core with the
 * warmth only at its thin rim. At full `uLeafSil` and a fully backlit view the
 * crown core loses `indirect` of its indirect and `direct` of its direct
 * diffuse; it fades out with the rim and as the view turns away from the sun
 * (`back` smoothstep), so a crown seen with the sun behind the eye is untouched.
 */
export const LEAF_SILHOUETTE = { indirect: 0.45, direct: 0.3, back: [0.15, 0.6] as const } as const;

/**
 * LOOK r6 (L4b): a crown's contre-jour EDGE — its outer shell (the AO rim)
 * where the crown turns away from the eye (1 − facing, smoothstep `band`).
 * The r5 AO rim alone lit every card on the crown's near face (the whole
 * crown went gold at rules); the edge keeps the gold to the silhouette.
 */
export const LEAF_EDGE_BAND = [0.45, 0.92] as const;

/** Transmission / gold-mix weights over max(thin, edge): floor at the core, 1 at the edge. */
export const LEAF_EDGE_WEIGHT = { floor: 0.15, goldFloor: 0.1 } as const;

/** JS mirror of the GLSL `sssEdge`. */
export function leafEdge(ao: number, facing: number): number {
  const rim = clamp01((ao - CANOPY_AO.core) / (CANOPY_AO.rim - CANOPY_AO.core));
  return rim * smoothstep(LEAF_EDGE_BAND[0], LEAF_EDGE_BAND[1], 1 - clamp01(facing));
}

/**
 * The silhouette strength (module scope). DEFAULT 0 — sakura, mountain and
 * clouds never write it; the plaza's `Trees.tsx` writes 1 by day.
 */
export const LEAF_SIL: { value: number } = { value: 0 };

/**
 * LOOK r6 (L6.3): warm lamp under-light on the canopy — `#ffc890` × strength
 * (linear) at night near a lamp (the per-vertex `aLamp` proximity baked at
 * build), weighted toward the crown's underside. DEFAULT 0 (other worlds, day).
 */
export const LEAF_LAMP_COLOR = '#ffc890';
export const LEAF_LAMP: { value: THREE.Color } = { value: new THREE.Color(0, 0, 0) };

/**
 * ROLLOUT §2.2 (h): the canopy's translucent-edge hue per skin
 * (`TreeSkin.canopyEdge`). `linden-gold` is `LEAF_GOLD` itself (the plaza,
 * byte-identical); `blossom-peach` is sakura's peach-pink transmitted edge
 * over a rose body; `aspen-gold` is mountain's starting point (the AD tunes
 * it). R > G on every edge so AgX's yellow skew never lands on chartreuse.
 */
export interface CanopyEdgeLook {
  body: readonly [number, number, number];
  gold: readonly [number, number, number];
  lumFloor: number;
  gain: number;
}

export const CANOPY_EDGE_PRESETS: Readonly<Record<CanopyEdgePreset, CanopyEdgeLook>> = {
  'linden-gold': LEAF_GOLD,
  'blossom-peach': { body: [1.2, 1.0, 0.92], gold: [1.0, 0.7, 0.64], lumFloor: LEAF_GOLD.lumFloor, gain: LEAF_GOLD.gain },
  'aspen-gold': { body: [1.3, 1.02, 0.58], gold: [1.0, 0.68, 0.26], lumFloor: LEAF_GOLD.lumFloor, gain: LEAF_GOLD.gain },
};

/** The default edge (the plaza's). */
export const DEFAULT_CANOPY_EDGE: CanopyEdgePreset = 'linden-gold';

/** Program cache key of the painted canopy (the paint sweep chains after it). */
export const CANOPY_PROGRAM_KEY = 'tree-canopy-painted-v4';

/** The canopy program key of an edge preset (`linden-gold` keeps the plaza's key). */
export function canopyProgramKey(edge: CanopyEdgePreset = DEFAULT_CANOPY_EDGE): string {
  return edge === DEFAULT_CANOPY_EDGE ? CANOPY_PROGRAM_KEY : `${CANOPY_PROGRAM_KEY}|edge:${edge}`;
}

/**
 * Hand the canopy uniforms back at their module defaults (ROLLOUT §2.2 b/h):
 * translucency at the day level, no silhouette, no lamp under-light.
 */
export function resetCanopyLight(): void {
  LEAF_SSS.value = LEAF_SSS_LEVELS.day;
  LEAF_SIL.value = 0;
  LEAF_LAMP.value.setRGB(0, 0, 0);
}

/** A painted-canopy card as the geometry builder needs it (a `CanopyCard` subset). */
export interface CanopyCardInput {
  position: { x: number; y: number; z: number };
  yaw: number;
  tilt: number;
  scale: number;
  set: 'A' | 'B';
  swayPhase: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * JS mirror of the canopy's translucency term (`CANOPY_SSS_GLSL`), for the
 * clamp test: key light through a leaf toward the eye, strongest at thin card
 * fringes and on the crown rim, times the albedo, the key and the palette
 * strength — clamped at `LEAF_SSS_CLAMP` per channel.
 */
export function leafTranslucency(input: {
  albedo: readonly [number, number, number];
  light: readonly [number, number, number];
  /** −dot(L, V): 1 = looking straight into the key through the leaf. */
  back: number;
  /** Map alpha at the fragment (thin near the alphaTest cut). */
  alpha: number;
  /** Vertex AO (CANOPY_AO.core … rim). */
  ao: number;
  strength: number;
  /**
   * LOOK r6: dot(crown normal, view) — 1 where the crown faces the eye (its
   * core in silhouette), 0 at its edge. Optional (0: the AO rim alone decides).
   */
  facing?: number;
}): [number, number, number] {
  const back = clamp01(input.back);
  const b2 = back * back;
  const thin = 1 - smoothstep(LEAF_ALPHA_TEST, 0.95, input.alpha);
  const edge = leafEdge(input.ao, input.facing ?? 0);
  const t = b2 * (LEAF_SSS_LOBE_FLOOR + (1 - LEAF_SSS_LOBE_FLOOR) * b2) * (LEAF_EDGE_WEIGHT.floor + (1 - LEAF_EDGE_WEIGHT.floor) * Math.max(thin, edge)) * Math.max(0, input.strength);
  const lum = Math.max(0, 0.2126 * input.albedo[0] + 0.7152 * input.albedo[1] + 0.0722 * input.albedo[2]);
  // LOOK r6 (L4b): gold transmission, independent of the albedo's hue.
  const goldT = clamp01(LEAF_EDGE_WEIGHT.goldFloor + (1 - LEAF_EDGE_WEIGHT.goldFloor) * Math.max(thin, edge));
  const tint = (c: 0 | 1 | 2) => {
    const body = input.albedo[c] * LEAF_GOLD.body[c];
    return body + (LEAF_GOLD.gold[c] * Math.max(lum, LEAF_GOLD.lumFloor) * LEAF_GOLD.gain - body) * goldT;
  };
  return [
    Math.min(tint(0) * input.light[0] * t, LEAF_SSS_CLAMP),
    Math.min(tint(1) * input.light[1] * t, LEAF_SSS_CLAMP),
    Math.min(tint(2) * input.light[2] * t, LEAF_SSS_CLAMP),
  ];
}

/**
 * JS mirror of the canopy's contre-jour silhouette (`CANOPY_SSS_GLSL`): the
 * multipliers on the crown's indirect and direct diffuse for a fragment's AO
 * (core → rim), the backlit cosine and the `uLeafSil` strength.
 */
export function leafSilhouette(input: { ao: number; back: number; sil: number; facing?: number }): { indirect: number; direct: number } {
  const edge = leafEdge(input.ao, input.facing ?? 0);
  const s = Math.max(0, input.sil) * (1 - edge) * smoothstep(LEAF_SILHOUETTE.back[0], LEAF_SILHOUETTE.back[1], clamp01(input.back));
  return { indirect: 1 - LEAF_SILHOUETTE.indirect * s, direct: 1 - LEAF_SILHOUETTE.direct * s };
}

/**
 * Translucency, injected after `lights_fragment_end`: the first directional
 * light (the key) seen through the leaf. A pure addition to the direct
 * diffuse, clamped per channel so a backlit crown stays under the bloom knee.
 */
export function canopySssGlsl(edge: CanopyEdgePreset = DEFAULT_CANOPY_EDGE): string {
  const look = CANOPY_EDGE_PRESETS[edge];
  return [
  '#if NUM_DIR_LIGHTS > 0',
  '{',
  '  vec3 sssL = directionalLights[ 0 ].direction;',
  '  float sssBack = saturate( - dot( sssL, geometryViewDir ) );',
  '  float sssB2 = sssBack * sssBack;',
  `  float sssThin = 1.0 - smoothstep( ${LEAF_ALPHA_TEST.toFixed(3)}, 0.95, diffuseColor.a );`,
  `  float sssRim = saturate( ( vColor.r - ${CANOPY_AO.core.toFixed(3)} ) / ${(CANOPY_AO.rim - CANOPY_AO.core).toFixed(3)} );`,
  // LOOK r6 (L4b): the crown's contre-jour edge (its shell, turned away from the eye).
  `  float sssEdge = sssRim * smoothstep( ${LEAF_EDGE_BAND[0].toFixed(2)}, ${LEAF_EDGE_BAND[1].toFixed(2)}, 1.0 - saturate( dot( normal, geometryViewDir ) ) );`,
  `  float sssT = sssB2 * ( ${LEAF_SSS_LOBE_FLOOR.toFixed(2)} + ${(1 - LEAF_SSS_LOBE_FLOOR).toFixed(2)} * sssB2 ) * ( ${LEAF_EDGE_WEIGHT.floor.toFixed(2)} + ${(1 - LEAF_EDGE_WEIGHT.floor).toFixed(2)} * max( sssThin, sssEdge ) ) * max( uLeafSSS, 0.0 );`,
  '  vec3 sssKey = directionalLights[ 0 ].color;',
  // LOOK r3: a painted canopy sees the painted key (the scene keeps the shipped one).
  '  #ifdef PAINT_KEY_SCALE',
  '  sssKey *= PAINT_KEY_SCALE;',
  '  #endif',
  '  float sssLum = max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0 );',
  // LOOK r6 (L4b): gold transmission (R > G), independent of the albedo's hue.
  `  vec3 sssAlb = mix( diffuseColor.rgb * vec3( ${look.body.map((c) => c.toFixed(3)).join(', ')} ), vec3( ${look.gold.map((c) => c.toFixed(3)).join(', ')} ) * max( sssLum, ${look.lumFloor.toFixed(3)} ) * ${look.gain.toFixed(2)}, saturate( ${LEAF_EDGE_WEIGHT.goldFloor.toFixed(2)} + ${(1 - LEAF_EDGE_WEIGHT.goldFloor).toFixed(2)} * max( sssThin, sssEdge ) ) );`,
  // LOOK r6 (L4b): the contre-jour silhouette — a darker crown core (plaza only; uLeafSil 0 elsewhere).
  `  float sssSil = uLeafSil * ( 1.0 - sssEdge ) * smoothstep( ${LEAF_SILHOUETTE.back[0].toFixed(2)}, ${LEAF_SILHOUETTE.back[1].toFixed(2)}, sssBack );`,
  `  reflectedLight.indirectDiffuse *= 1.0 - ${LEAF_SILHOUETTE.indirect.toFixed(2)} * sssSil;`,
  `  reflectedLight.directDiffuse *= 1.0 - ${LEAF_SILHOUETTE.direct.toFixed(2)} * sssSil;`,
  `  reflectedLight.directDiffuse += min( sssAlb * sssKey * sssT, vec3( ${LEAF_SSS_CLAMP.toFixed(3)} ) );`,
  '}',
  '#endif',
  // LOOK r6 (L6.3): warm lamp under-light near the plaza's lamps at night
  // (uLeafLamp 0 by day and in every other world), strongest on the underside.
  '{',
  '  float lampDown = saturate( - dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) );',
  '  reflectedLight.directDiffuse += uLeafLamp * vLeafLamp * ( 0.45 + 0.55 * lampDown ) * mix( diffuseColor.rgb * 2.0, vec3( 0.35 ), 0.3 );',
  '}',
  ].join('\n');
}

/** The plaza's (`linden-gold`) translucency chunk — the r6 source of record. */
export const CANOPY_SSS_GLSL = canopySssGlsl(DEFAULT_CANOPY_EDGE);

/** The wind sway (the C-100 card hook's GLSL, verbatim) + LOOK r6's lamp proximity varying. */
const WIND_VERTEX_DECL =
  '#include <common>\nuniform float uTime;\nattribute float aSway;\nattribute float aPhase;\nattribute float aLamp;\nvarying float vLeafLamp;';
const WIND_VERTEX_BODY =
  '#include <begin_vertex>\nfloat windAmp = aSway * 0.11;\ntransformed.x += sin(uTime * 1.6 + aPhase) * windAmp;\ntransformed.z += cos(uTime * 1.15 + aPhase * 1.7) * windAmp * 0.7;\nvLeafLamp = aLamp;';

/**
 * Spherical normals survive double-siding: three flips `normal` by
 * `faceDirection` on back faces, which would turn a crown's radial normal
 * inward on every card seen from behind. The canopy re-reads the
 * interpolated normal after the flip (leaves carry no normal map, so the tbn
 * is unused).
 */
const CANOPY_NORMAL_GLSL = '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;';

/** The anchors the canopy hooks replace (the anchor test holds them against three's chunks). */
export const CANOPY_ANCHORS = {
  vertex: ['#include <common>', '#include <begin_vertex>'],
  fragment: ['#include <common>', '#include <normal_fragment_begin>', '#include <lights_fragment_end>'],
} as const;

/** Apply the canopy's shader hooks to a shader descriptor (exported for the anchor test). */
export function patchCanopyShader(
  shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string },
  windClock: { value: number },
  edge: CanopyEdgePreset = DEFAULT_CANOPY_EDGE,
): void {
  shader.uniforms.uTime = windClock;
  shader.uniforms.uLeafSSS = LEAF_SSS;
  shader.uniforms.uLeafSil = LEAF_SIL;
  shader.uniforms.uLeafLamp = LEAF_LAMP;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', WIND_VERTEX_DECL)
    .replace('#include <begin_vertex>', WIND_VERTEX_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform float uLeafSSS;\nuniform float uLeafSil;\nuniform vec3 uLeafLamp;\nvarying float vLeafLamp;',
    )
    .replace('#include <normal_fragment_begin>', CANOPY_NORMAL_GLSL)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${edge === DEFAULT_CANOPY_EDGE ? CANOPY_SSS_GLSL : canopySssGlsl(edge)}`);
}

/**
 * The canopy atlas: the skin's A card over its B card in ONE texture, so a
 * tree's whole canopy is one material and one importance-sorted draw range
 * (two maps would split the range per material). Rows follow
 * `cardDataTexture`'s flip; A occupies v ∈ [0, 0.5), B v ∈ [0.5, 1]. Both
 * cards' alpha reaches 0 inside their borders (the seam law above), so mip
 * filtering never bleeds a leaf across the seam.
 */
export function canopyAtlasTexture(dataA: Uint8Array, dataB: Uint8Array, size: number): THREE.DataTexture {
  const row = size * 4;
  const atlas = new Uint8Array(row * size * 2);
  for (let y = 0; y < size; y += 1) {
    atlas.set(dataA.subarray((size - 1 - y) * row, (size - y) * row), y * row);
    atlas.set(dataB.subarray((size - 1 - y) * row, (size - y) * row), (size + y) * row);
  }
  const tex = new THREE.DataTexture(atlas, size, size * 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** The painted canopy material: wind + spherical normals + vertex AO + translucency (edge hue per preset). */
export function createCanopyMaterial(
  atlas: THREE.Texture,
  windClock: { value: number },
  edge: CanopyEdgePreset = DEFAULT_CANOPY_EDGE,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: LEAF_ALPHA_TEST,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => patchCanopyShader(shader, windClock, edge);
  const key = canopyProgramKey(edge);
  material.customProgramCacheKey = () => key;
  // The painted light's foliage response (a uniform; plaza paint sweep only).
  material.userData.paintRole = 'foliage';
  return material;
}

/** LOOK r6 (L6.3): how far a lamp's under-light reaches into a crown (m, from the lamp head). */
export const LEAF_LAMP_REACH_M = 4.2;

/**
 * Lamp proximity of a tree-LOCAL canopy point for a tree at `origin` turned by
 * `yaw` (three's rotation about +Y), against lamp HEAD positions (world):
 * 1 at a head, 0 beyond `LEAF_LAMP_REACH_M`. Pure; baked once per geometry.
 */
export function lampProximity(
  lamps: readonly (readonly [number, number, number])[],
  origin: readonly [number, number, number],
  yaw: number,
): (x: number, y: number, z: number) => number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (x, y, z) => {
    const wx = origin[0] + x * c + z * s;
    const wy = origin[1] + y;
    const wz = origin[2] - x * s + z * c;
    let best = 0;
    for (const lamp of lamps) {
      const d = Math.hypot(wx - lamp[0], wy - lamp[1], wz - lamp[2]);
      best = Math.max(best, 1 - smoothstep(0.6, LEAF_LAMP_REACH_M, d));
    }
    return best;
  };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/** Card-local corners in PlaneGeometry(1, 1) order: x, y, u, v. */
const CARD_CORNERS = [
  [-0.5, 0.5, 0, 1],
  [0.5, 0.5, 1, 1],
  [-0.5, -0.5, 0, 0],
  [0.5, -0.5, 1, 0],
] as const;
/** PlaneGeometry's winding. */
const CARD_INDEX = [0, 2, 1, 2, 3, 1] as const;

/**
 * One tree's canopy as ONE indexed geometry, cards in the given (importance)
 * order so `setDrawRange(0, n · 6)` draws the first n. Each card is the
 * C-100 card (a unit plane at the card's position, rotation [tilt, yaw, 0]
 * and scale card.scale × cardScaleM) baked into the tree's local frame, plus:
 * - `normal`: `CANOPY_RADIAL_NORMAL` of the direction from the crown centre,
 *   the rest the card's own facing (flipped to agree), so the crown shades as
 *   one brushy mass;
 * - `color`: vertex AO from `CANOPY_AO.core` at the crown centre to
 *   `CANOPY_AO.rim` at its surface;
 * - `aSway` / `aPhase`: the wind attributes the card path carries.
 * A single group spans the index; the mesh renders with a one-entry material
 * array (see `Tree.tsx`).
 */
export function buildCanopyGeometry(
  cards: readonly CanopyCardInput[],
  cardScaleM: number,
  crown: { center: { x: number; y: number; z: number }; radius: number },
  /** LOOK r6 (L6.3): lamp proximity (0..1) of a tree-LOCAL point; absent = 0 everywhere. */
  lampAt?: (x: number, y: number, z: number) => number,
): THREE.BufferGeometry {
  const n = cards.length;
  const position = new Float32Array(n * 12);
  const normal = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const color = new Float32Array(n * 12);
  const sway = new Float32Array(n * 4);
  const phase = new Float32Array(n * 4);
  const lamp = new Float32Array(n * 4);
  const index = new Uint16Array(n * 6);
  const radius = Math.max(1e-3, crown.radius);
  cards.forEach((card, c) => {
    _e.set(card.tilt, card.yaw, 0);
    _q.setFromEuler(_e);
    const s = card.scale * cardScaleM;
    _p.set(card.position.x, card.position.y, card.position.z);
    _m.compose(_p, _q, _s.set(s, s, s));
    _nm.getNormalMatrix(_m);
    const vBase = card.set === 'A' ? 0 : 0.5;
    CARD_CORNERS.forEach(([lx, ly, u, v], k) => {
      const o = c * 4 + k;
      _v.set(lx, ly, 0).applyMatrix4(_m);
      position.set([_v.x, _v.y, _v.z], o * 3);
      _r.set(_v.x - crown.center.x, _v.y - crown.center.y, _v.z - crown.center.z);
      const dist = _r.length();
      if (dist > 1e-6) _r.multiplyScalar(1 / dist);
      else _r.set(0, 1, 0);
      _n.set(0, 0, 1).applyMatrix3(_nm).normalize();
      if (_n.dot(_r) < 0) _n.negate();
      _n.multiplyScalar(1 - CANOPY_RADIAL_NORMAL).addScaledVector(_r, CANOPY_RADIAL_NORMAL).normalize();
      normal.set([_n.x, _n.y, _n.z], o * 3);
      uv.set([u, vBase + v * 0.5], o * 2);
      const ao = CANOPY_AO.core + (CANOPY_AO.rim - CANOPY_AO.core) * smoothstep(0.15, 0.95, dist / radius);
      color.set([ao, ao, ao], o * 3);
      sway[o] = clamp01(ly + 0.5);
      phase[o] = card.swayPhase;
      lamp[o] = lampAt ? clamp01(lampAt(_v.x, _v.y, _v.z)) : 0;
    });
    CARD_INDEX.forEach((i, k) => {
      index[c * 6 + k] = c * 4 + i;
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.addGroup(0, index.length, 0);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// ── Painted crown builders (ROLLOUT §2.2 h) ─────────────────────────────────

/**
 * The attribute set every painted-canopy geometry carries (name → item
 * size). A crown builder MUST produce exactly this set so its tree shares the
 * one canopy program (three keys programs on attribute presence, e.g.
 * `vertexNormals`, `vertexAlphas`).
 */
export const CANOPY_ATTRIBUTES: Readonly<Record<string, number>> = {
  position: 3,
  normal: 3,
  uv: 2,
  color: 3,
  aSway: 1,
  aPhase: 1,
  aLamp: 1,
};

/**
 * A degenerate one-card canopy geometry with the full canopy attribute set
 * and one group, drawn with an empty range: the mounted mesh links the
 * canopy program in the ceremony, then `adoptCrownGeometry` fills it from
 * the paint queue.
 */
export function createCrownPlaceholderGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of Object.entries(CANOPY_ATTRIBUTES)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(4 * size), size));
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 2, 1, 2, 3, 1]), 1));
  geometry.addGroup(0, 6, 0);
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  return geometry;
}

/** Whether a built crown carries exactly the canopy attribute set (same names and item sizes). */
export function hasCanopyAttributes(geometry: THREE.BufferGeometry): boolean {
  const names = Object.keys(geometry.attributes);
  if (names.length !== Object.keys(CANOPY_ATTRIBUTES).length) return false;
  return names.every((name) => CANOPY_ATTRIBUTES[name] === geometry.getAttribute(name).itemSize);
}

/**
 * Move a built crown's buffers INTO `target` (the mounted placeholder): the
 * same attribute names, the index, the groups and the bounds. Throws when
 * the crown's attribute set differs (it would link a second program).
 */
export function adoptCrownGeometry(target: THREE.BufferGeometry, source: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!hasCanopyAttributes(source)) {
    throw new Error('[canopy] a painted crown must carry exactly the canopy attribute set (CANOPY_ATTRIBUTES)');
  }
  for (const name of Object.keys(CANOPY_ATTRIBUTES)) target.setAttribute(name, source.getAttribute(name));
  target.setIndex(source.getIndex());
  target.clearGroups();
  const groups = source.groups.length > 0 ? source.groups : [{ start: 0, count: source.getIndex()?.count ?? 0, materialIndex: 0 }];
  for (const group of groups) target.addGroup(group.start, group.count, group.materialIndex ?? 0);
  if (!source.boundingSphere) source.computeBoundingSphere();
  if (!source.boundingBox) source.computeBoundingBox();
  target.boundingSphere = source.boundingSphere?.clone() ?? null;
  target.boundingBox = source.boundingBox?.clone() ?? null;
  return target;
}
