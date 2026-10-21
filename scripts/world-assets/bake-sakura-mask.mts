/**
 * The sakura story mask (ROLLOUT-PLAN §1.1 ground, §3.3 item 3, §5) →
 * 512² RGBA LOSSLESS WebP at `public/models/world/env/sakura/mask.webp`.
 * Layout, uv law and channel names: `SAKURA_MASK` (world-env.ts).
 *
 *   R  path wear        the south sandō and the east-west crossing path
 *                       (`Ground.tsx` strips), worn along their centre lines
 *   G  moss and tree AO contact AO at every tree trunk, moss under the
 *                       crowns and along the shrine wall foot
 *   B  petal drift      static drifts under the cherry crowns and on the
 *                       shore ring, FORCED 0 inside every keep-out wedge
 *                       and every dry (footer) band of SAKURA_DATA_SURFACES,
 *                       dilated by `dryMarginM`
 *   A  macro noise      anti-tiling index (64 levels)
 *
 * The lake interior carries 0 in R and B. Deterministic (integer-hash noise;
 * hash test in `__tests__/rollout-bakes.test.mjs`).
 *
 * AD-SAKURA owns `PARAMS` from B5; `lib.mjs` stays frozen.
 *
 * Usage: npx tsx scripts/world-assets/bake-sakura-mask.mts [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SAKURA_DATA_SURFACES } from '../../src/components/world/themes/sakura/furniture/data-faces';
import { LAKE, SHRINE, TREE_PLACEMENTS, treeCanopyReachM } from '../../src/components/world/themes/sakura/furniture/layout';
import { cameraBasis, themeWedges, wedgeHitsSphere } from '../../src/lib/route-world/data-surfaces';
import { dryScreenZones } from '../../src/lib/route-world/plaza-ground';
import { SAKURA_MASK } from '../../src/lib/route-world/world-env';
import {
  clamp01,
  createWorldDryBand,
  encodeLosslessRgba,
  hash3,
  rasterWorldMask,
  segmentDistance,
  sha256Hex,
  smoothstep,
  worldFbm,
} from './lib.mjs';

// ── Parameter block (AD-SAKURA) ─────────────────────────────────────────────

export const PARAMS = {
  /** Path strips [from, to, half-width] (Ground.tsx: 2.4 × 18.4 at z 4.6; 25 × 2.2 at z −0.4). */
  paths: [
    { from: [0, -4.6], to: [0, 13.8], half: 1.2 },
    { from: [-12.5, -0.4], to: [12.5, -0.4], half: 1.1 },
  ] as { from: [number, number]; to: [number, number]; half: number }[],
  wear: { core: 0.45, strength: 0.85, breakup: 0.35 },
  /** Trunk AO radius (m) = base + perM · height; moss under the crown to `mossReach` of the canopy reach. */
  treeAo: { base: 0.8, perM: 0.08, strength: 0.75 },
  moss: { reach: 0.8, strength: 0.45, cell: 1.6 },
  shrineFoot: { depth: 0.9, strength: 0.6 },
  /** Petal drift under cherry crowns (share of the reach) and on the shore ring (ellipse radius 1.0–1.3). */
  petals: { reach: 0.95, shore: [1.0, 1.3] as [number, number], cell: 1.2, threshold: 0.42, strength: 0.9 },
  macro: { cell: 7, octaves: 4, seed: 61 },
  /** Card-scale leaf jitter assumed for the canopy reach (layout `treeCanopyReachM`). */
  cardScaleM: 1.3,
};

// ── Fields ───────────────────────────────────────────────────────────────────

function lakeRadius(x: number, z: number): number {
  return Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
}

export function sakuraFields(x: number, z: number): [number, number, number, number] {
  const inLake = lakeRadius(x, z) < 1;
  // R: path wear, strongest on the centre line, broken by low-frequency noise.
  let wear = 0;
  for (const p of PARAMS.paths) {
    const d = segmentDistance(x, z, p.from, p.to);
    wear = Math.max(wear, 1 - smoothstep(p.half * PARAMS.wear.core, p.half + 0.3, d));
  }
  wear *= PARAMS.wear.strength * (1 - PARAMS.wear.breakup + PARAMS.wear.breakup * worldFbm(x, z, 2.2, 3, 71));
  // G: trunk AO + moss under crowns + shrine wall foot.
  let ao = 0;
  let moss = 0;
  let petals = 0;
  for (const t of TREE_PLACEMENTS) {
    const d = Math.hypot(x - t.x, z - t.z);
    const r = PARAMS.treeAo.base + PARAMS.treeAo.perM * t.heightM;
    ao = Math.max(ao, PARAMS.treeAo.strength * Math.exp(-((d / r) ** 2)));
    const reach = treeCanopyReachM(t.heightM, PARAMS.cardScaleM);
    moss = Math.max(moss, 1 - smoothstep(reach * PARAMS.moss.reach * 0.5, reach * PARAMS.moss.reach, d));
    if (t.skin === 'cherry') petals = Math.max(petals, 1 - smoothstep(reach * PARAMS.petals.reach * 0.55, reach * PARAMS.petals.reach, d));
  }
  moss *= PARAMS.moss.strength * worldFbm(x, z, PARAMS.moss.cell, 3, 83);
  const shrineD = Math.max(Math.abs(x - SHRINE.x) - 0.3, Math.abs(z - SHRINE.z) - SHRINE.length / 2);
  const foot = shrineD < 0 ? 1 : 1 - smoothstep(0, PARAMS.shrineFoot.depth, shrineD);
  const g = clamp01(Math.max(ao, moss, foot * PARAMS.shrineFoot.strength));
  // B: petal drifts — crowns and the shore ring, patchy, with a speck grain.
  const lr = lakeRadius(x, z);
  const shore = smoothstep(PARAMS.petals.shore[0], PARAMS.petals.shore[0] + 0.04, lr) * (1 - smoothstep(PARAMS.petals.shore[1] - 0.1, PARAMS.petals.shore[1], lr));
  const patch = smoothstep(PARAMS.petals.threshold, PARAMS.petals.threshold + 0.2, worldFbm(x, z, PARAMS.petals.cell, 3, 97));
  const speck = 0.75 + 0.25 * hash3(Math.floor(x * 8), Math.floor(z * 8), 101);
  let b = Math.max(petals, shore * 0.8) * patch * speck * PARAMS.petals.strength;
  if (inLake) {
    wear = 0;
    b = 0;
  }
  return [wear, g, b, worldFbm(x, z, PARAMS.macro.cell, PARAMS.macro.octaves, PARAMS.macro.seed)];
}

export function buildSakuraMask() {
  const dry = createWorldDryBand({
    zones: dryScreenZones(SAKURA_DATA_SURFACES),
    wedges: themeWedges(SAKURA_DATA_SURFACES),
    cameraBasis,
    wedgeHitsSphere,
    groundY: () => 0,
  });
  return { ...rasterWorldMask({ layout: SAKURA_MASK, fields: sakuraFields, dry }), dry };
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'sakura');
  ensureDir(dir);
  const t0 = Date.now();
  const raster = buildSakuraMask();
  const bytes = await encodeLosslessRgba(raster);
  const file = join(dir, 'mask.webp');
  writeFileSync(file, bytes);
  const forbidden = raster.forbidden.reduce((s: number, v: number) => s + v, 0);
  log(
    `sakura mask ${raster.size}² → ${file} ${Math.round(statSync(file).size / 1024)} KB in ${Date.now() - t0} ms; ` +
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
