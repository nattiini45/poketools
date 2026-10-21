/**
 * The mountain ridge atlas (ROLLOUT-PLAN §1.2 horizon, §3.3 item 3, §5) →
 * 2048 × 512 lossless RGBA WebP at `public/models/world/env/mountain/skyline.webp`.
 * It replaces the 16 runtime canvas ridge billboards (`Ridges.tsx`) with the
 * three static skyline bands of `MOUNTAIN_SKYLINE_ATLAS` (world-env.ts):
 * r 46 / 74 / 120, per-band top elevations, the plaza's uv law.
 *
 *   R  near: dark granite ridges with a conifer fringe (saw-tooth crowns
 *      where the crest runs low), and a lower col at the pass (south)
 *   G  mid:  sharper peaks
 *   B  far:  the highest, broad snow massifs (the snowfields are an ink /
 *      shader matter: the atlas is coverage only)
 *   A  0 (no windows; `SkylineSpec.windows` false)
 *
 * Peaks are hashed triangles plus periodic fBm roughness — seamless at
 * u 0 / 1, the same bytes on every run (hash test).
 *
 * AD-MOUNTAIN owns `PARAMS` from B6; `lib.mjs` stays frozen.
 *
 * Usage: node scripts/world-assets/bake-mountain-ridges.mjs [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeLosslessRgba, hash3, rasterSkylineAtlas, ringDelta, ringFbm, sha256Hex } from './lib.mjs';

/** Mirrors `MOUNTAIN_SKYLINE_ATLAS` (world-env.ts; asserted equal by the bake test). */
export const ATLAS = {
  file: 'env/mountain/skyline.webp',
  width: 2048,
  height: 512,
  radii: [46, 74, 120],
  topElevationDeg: [15, 19, 22],
};

// ── Parameter block (AD-MOUNTAIN) ───────────────────────────────────────────

export const PARAMS = {
  bands: [
    // near: granite shoulders; many low peaks.
    { channel: 0, peaks: 22, min: 0.34, max: 0.72, slope: [0.7, 1.3], rough: 0.06, cells: 24, base: 0.26, seed: 401 },
    // mid: sharper, taller peaks.
    { channel: 1, peaks: 16, min: 0.45, max: 0.9, slope: [0.8, 1.5], rough: 0.05, cells: 20, base: 0.3, seed: 523 },
    // far: the snow massifs.
    { channel: 2, peaks: 11, min: 0.55, max: 0.98, slope: [0.6, 1.1], rough: 0.035, cells: 14, base: 0.36, seed: 647 },
  ],
  /** Conifer fringe on the near band: crowns per turn, crown height (v), active below `under` v. */
  conifers: { count: 900, height: 0.05, under: 0.5 },
  /**
   * The pass: the rules camera looks south (u 0.25) through the gate toward
   * the low sun — the near and mid bands drop to a col there.
   */
  pass: { u: 0.25, halfWidth: 0.045, near: 0.3, mid: 0.42 },
};

// ── Shapes ───────────────────────────────────────────────────────────────────

/** Crest v of band k at azimuth u. */
export function ridgeTop(k, u) {
  const b = PARAMS.bands[k];
  let top = b.base;
  for (let i = 0; i < b.peaks; i += 1) {
    const pu = (i + 0.2 + 0.6 * hash3(i, k, b.seed)) / b.peaks;
    const height = b.min + (b.max - b.min) * hash3(i, k, b.seed + 1);
    const slope = b.slope[0] + (b.slope[1] - b.slope[0]) * hash3(i, k, b.seed + 2);
    // Slope in v per turn-of-peak-spacing: the flank falls `slope` × height over one spacing.
    const d = Math.abs(ringDelta(u, pu)) * b.peaks;
    top = Math.max(top, height - d * slope * height);
  }
  top += b.rough * (ringFbm(u, b.cells, 4, b.seed + 3) - 0.5) * 2;
  const pass = PARAMS.pass;
  const cap = k === 0 ? pass.near : k === 1 ? pass.mid : 1;
  const inPass = 1 - Math.min(1, Math.abs(ringDelta(u, pass.u)) / pass.halfWidth);
  if (inPass > 0) top = Math.min(top, cap + (top - cap) * (1 - inPass * inPass * (3 - 2 * inPass)));
  if (k === 0) {
    const c = PARAMS.conifers;
    const s = u * c.count;
    const i = Math.floor(s);
    const t = s - i;
    const fringe = Math.max(0, 1 - top / c.under);
    if (fringe > 0) top += c.height * (0.5 + 0.5 * fringe) * (0.6 + 0.4 * hash3(i % c.count, 7, 811)) * (1 - Math.abs(2 * t - 1));
  }
  return Math.min(0.99, Math.max(0.1, top));
}

export function buildMountainRidges() {
  return rasterSkylineAtlas({
    width: ATLAS.width,
    height: ATLAS.height,
    bands: [0, 1, 2].map((k) => ({ channel: PARAMS.bands[k].channel, spans: (u) => [[0, ridgeTop(k, u)]] })),
  });
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'mountain');
  ensureDir(dir);
  const raster = buildMountainRidges();
  const bytes = await encodeLosslessRgba(raster);
  const file = join(dir, 'skyline.webp');
  writeFileSync(file, bytes);
  log(`mountain ridges ${raster.width}×${raster.height} → ${file} ${Math.round(statSync(file).size / 1024)} KB; raw sha256 ${sha256Hex(raster.data).slice(0, 16)}, file sha256 ${sha256Hex(bytes).slice(0, 16)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
