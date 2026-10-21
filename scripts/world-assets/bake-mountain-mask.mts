/**
 * The mountain story mask (ROLLOUT-PLAN §1.2 ground, §3.3 item 3, §5) →
 * 512² RGBA LOSSLESS WebP at `public/models/world/env/mountain/mask.webp`.
 * Layout, uv law and channel names: `MOUNTAIN_MASK` (world-env.ts).
 *
 *   R  trail wear       the trail ring, spurs, switchbacks and worn social
 *                       paths (`TRAIL_SEGMENTS`, `SWITCHBACKS`, `WORN_PATHS`)
 *   G  scree / contact  the scree skirt at the knoll toe and the crag
 *                       (`SCREE_ANCHORS`), outcrop feet, tree trunk AO
 *   B  lee snow + wet   lee snow patches high on the knoll and the wet tarn
 *                       shore band — FORCED 0 inside every keep-out wedge and
 *                       every dry (footer) band of MOUNTAIN_DATA_SURFACES
 *                       (projected onto the knoll surface), dilated
 *   A  macro noise      anti-tiling index (64 levels)
 *
 * The tarn interior carries 0 in R and B. Deterministic (hash test).
 *
 * AD-MOUNTAIN owns `PARAMS` from B6; `lib.mjs` stays frozen.
 *
 * Usage: npx tsx scripts/world-assets/bake-mountain-mask.mts [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MOUNTAIN_DATA_SURFACES } from '../../src/components/world/themes/mountain/furniture/data-faces';
import {
  KNOLL,
  OUTCROPS,
  SCREE_ANCHORS,
  SWITCHBACKS,
  TARN,
  TRAIL_SEGMENTS,
  TREE_PLACEMENTS,
  WORN_PATHS,
  knollHeight,
} from '../../src/components/world/themes/mountain/furniture/layout';
import { cameraBasis, themeWedges, wedgeHitsSphere } from '../../src/lib/route-world/data-surfaces';
import { dryScreenZones } from '../../src/lib/route-world/plaza-ground';
import { MOUNTAIN_MASK } from '../../src/lib/route-world/world-env';
import {
  clamp01,
  createWorldDryBand,
  encodeLosslessRgba,
  rasterWorldMask,
  segmentDistance,
  sha256Hex,
  smoothstep,
  worldFbm,
} from './lib.mjs';

// ── Parameter block (AD-MOUNTAIN) ───────────────────────────────────────────

export const PARAMS = {
  trail: { defaultWidth: 2.2, switchbackWidth: 1.2, core: 0.4, strength: 0.85, breakup: 0.35 },
  scree: { radius: 1.1, strength: 0.8, toeBand: 1.4, toeStrength: 0.55 },
  outcrop: { grow: 0.6, strength: 0.7 },
  treeAo: { base: 0.7, perM: 0.07, strength: 0.7 },
  /** Lee snow: patches where the knoll stands above `minHeight` m, patchy by fBm. */
  snow: { minHeight: 2.2, cell: 2.4, threshold: 0.5, strength: 0.9 },
  /** Wet tarn band: ellipse radius 1.0–1.25. */
  wet: { band: [1.0, 1.25] as [number, number], strength: 0.8 },
  macro: { cell: 7, octaves: 4, seed: 163 },
};

// ── Fields ───────────────────────────────────────────────────────────────────

function tarnRadius(x: number, z: number): number {
  return Math.hypot((x - TARN.x) / TARN.rx, (z - TARN.z) / TARN.rz);
}

export function mountainFields(x: number, z: number): [number, number, number, number] {
  const t = PARAMS.trail;
  let wear = 0;
  const segs: { from: readonly [number, number]; to: readonly [number, number]; width: number }[] = [
    ...TRAIL_SEGMENTS.map((s) => ({ from: s.from, to: s.to, width: s.width ?? t.defaultWidth })),
    ...SWITCHBACKS.map((s) => ({ from: s.from, to: s.to, width: t.switchbackWidth })),
    ...WORN_PATHS,
  ];
  for (const s of segs) {
    const half = s.width / 2;
    const d = segmentDistance(x, z, s.from, s.to);
    wear = Math.max(wear, 1 - smoothstep(half * t.core, half + 0.3, d));
  }
  wear *= t.strength * (1 - t.breakup + t.breakup * worldFbm(x, z, 2.2, 3, 171));
  // G: scree skirt, outcrop feet, trunk AO.
  let g = 0;
  for (const [ax, az] of SCREE_ANCHORS) g = Math.max(g, PARAMS.scree.strength * (1 - smoothstep(0, PARAMS.scree.radius, Math.hypot(x - ax, z - az))));
  const toe = Math.abs(Math.hypot(x - KNOLL.x, z - KNOLL.z) - KNOLL.r * 0.92);
  g = Math.max(g, PARAMS.scree.toeStrength * (1 - smoothstep(0, PARAMS.scree.toeBand, toe)) * worldFbm(x, z, 1.4, 3, 181));
  for (const o of OUTCROPS) {
    const [ox, oz, r] = o;
    g = Math.max(g, PARAMS.outcrop.strength * (1 - smoothstep(r * 0.8, r + PARAMS.outcrop.grow, Math.hypot(x - ox, z - oz))));
  }
  for (const tr of TREE_PLACEMENTS) {
    const r = PARAMS.treeAo.base + PARAMS.treeAo.perM * tr.heightM;
    g = Math.max(g, PARAMS.treeAo.strength * Math.exp(-((Math.hypot(x - tr.x, z - tr.z) / r) ** 2)));
  }
  // B: lee snow high on the knoll + the wet tarn shore band.
  const s = PARAMS.snow;
  const high = smoothstep(s.minHeight, s.minHeight + 1, knollHeight(x, z));
  const snow = high * smoothstep(s.threshold, s.threshold + 0.15, worldFbm(x, z, s.cell, 3, 191)) * s.strength;
  const tr = tarnRadius(x, z);
  const wet = smoothstep(PARAMS.wet.band[0], PARAMS.wet.band[0] + 0.03, tr) * (1 - smoothstep(PARAMS.wet.band[1] - 0.08, PARAMS.wet.band[1], tr)) * PARAMS.wet.strength;
  let b = Math.max(snow, wet);
  if (tr < 1) {
    wear = 0;
    b = 0;
  }
  return [wear, clamp01(g), b, worldFbm(x, z, PARAMS.macro.cell, PARAMS.macro.octaves, PARAMS.macro.seed)];
}

export function buildMountainMask() {
  const dry = createWorldDryBand({
    zones: dryScreenZones(MOUNTAIN_DATA_SURFACES),
    wedges: themeWedges(MOUNTAIN_DATA_SURFACES),
    cameraBasis,
    wedgeHitsSphere,
    groundY: knollHeight,
  });
  return { ...rasterWorldMask({ layout: MOUNTAIN_MASK, fields: mountainFields, dry }), dry };
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'mountain');
  ensureDir(dir);
  const t0 = Date.now();
  const raster = buildMountainMask();
  const bytes = await encodeLosslessRgba(raster);
  const file = join(dir, 'mask.webp');
  writeFileSync(file, bytes);
  const forbidden = raster.forbidden.reduce((acc: number, v: number) => acc + v, 0);
  log(
    `mountain mask ${raster.size}² → ${file} ${Math.round(statSync(file).size / 1024)} KB in ${Date.now() - t0} ms; ` +
      `${raster.dry.zones} dry zones, ${raster.dry.wedges} wedges, forbidden ${((100 * forbidden) / raster.size ** 2).toFixed(1)} %; ` +
      `raw sha256 ${sha256Hex(raster.data).slice(0, 16)}, file sha256 ${sha256Hex(bytes).slice(0, 16)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
