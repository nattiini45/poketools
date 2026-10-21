/**
 * The clouds isle-cap story mask (ROLLOUT-PLAN §1.3 "ground", §3.3 item 3,
 * §5) → 512² RGBA LOSSLESS WebP at `public/models/world/env/clouds/mask.webp`.
 * Layout, uv law and channel names: `CLOUDS_MASK` (world-env.ts). The mask is
 * a top-down projection over every isle cap (`ISLES`, `SATELLITE`,
 * `SCATTER_ISLES`); off the caps every channel is 0.
 *
 *   R  worn paths       from each isle's centre to its mooring (`MOORINGS`)
 *                       and to its light-bridge attach points (`BRIDGES`)
 *   G  contact          the dark cap-edge contact ring and tree trunk AO
 *   B  flower specks    patchy meadow specks — FORCED 0 inside every
 *                       keep-out wedge and every dry (footer) band of
 *                       CLOUDS_DATA_SURFACES (projected onto the cap top), dilated
 *   A  macro noise      anti-tiling index (64 levels)
 *
 * Deterministic (hash test). (Not in the §3.3 file list by name, which lists
 * no clouds mask script although §5 ships `env/clouds/mask.webp`.)
 *
 * AD-CLOUDS owns `PARAMS` from B7; `lib.mjs` stays frozen.
 *
 * Usage: npx tsx scripts/world-assets/bake-clouds-mask.mts [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOUDS_DATA_SURFACES } from '../../src/components/world/themes/clouds/furniture/data-faces';
import { BRIDGES, ISLES, MOORINGS, SATELLITE, SCATTER_ISLES, TREE_PLACEMENTS, type Isle } from '../../src/components/world/themes/clouds/furniture/layout';
import { cameraBasis, themeWedges, wedgeHitsSphere } from '../../src/lib/route-world/data-surfaces';
import { dryScreenZones } from '../../src/lib/route-world/plaza-ground';
import { CLOUDS_MASK } from '../../src/lib/route-world/world-env';
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

// ── Parameter block (AD-CLOUDS) ─────────────────────────────────────────────

export const PARAMS = {
  path: { half: 0.45, core: 0.4, strength: 0.8, breakup: 0.3 },
  contact: { band: 0.7, strength: 0.75 },
  treeAo: { base: 0.7, perM: 0.07, strength: 0.7 },
  specks: { cell: 0.22, share: 0.1, patchCell: 1.8, patchThreshold: 0.45, strength: 0.9 },
  macro: { cell: 5, octaves: 4, seed: 263 },
};

// ── Fields ───────────────────────────────────────────────────────────────────

const ALL_ISLES: { id: string; isle: Isle }[] = [
  ...Object.entries(ISLES).map(([id, isle]) => ({ id, isle })),
  { id: 'satellite', isle: SATELLITE },
  ...SCATTER_ISLES.map((isle, i) => ({ id: `scatter-${i}`, isle })),
];

function isleAt(x: number, z: number): Isle | null {
  for (const { isle } of ALL_ISLES) if (Math.hypot(x - isle.x, z - isle.z) <= isle.r) return isle;
  return null;
}

function isleById(id: string): Isle {
  const found = ALL_ISLES.find((entry) => entry.id === id);
  if (!found) throw new Error(`no isle ${id}`);
  return found.isle;
}

/** Path segments: isle centre → mooring, and isle centre → bridge attach point on the rim. */
const PATHS: { from: [number, number]; to: [number, number] }[] = (() => {
  const out: { from: [number, number]; to: [number, number] }[] = [];
  for (const [id, m] of Object.entries(MOORINGS)) {
    const isle = isleById(id);
    out.push({ from: [isle.x, isle.z], to: [m.x, m.z] });
  }
  for (const b of BRIDGES) {
    for (const [end, other] of [
      [b.from, b.to],
      [b.to, b.from],
    ] as const) {
      const isle = isleById(end);
      // Attach toward the arc's control point (the bridge leaves the rim that way).
      const dx = b.ctrl[0] - isle.x;
      const dz = b.ctrl[1] - isle.z;
      const len = Math.hypot(dx, dz) || 1;
      out.push({ from: [isle.x, isle.z], to: [isle.x + (dx / len) * isle.r, isle.z + (dz / len) * isle.r] });
      void other;
    }
  }
  return out;
})();

export function cloudsFields(x: number, z: number): [number, number, number, number] {
  const isle = isleAt(x, z);
  if (!isle) return [0, 0, 0, 0];
  const p = PARAMS.path;
  let wear = 0;
  for (const s of PATHS) wear = Math.max(wear, 1 - smoothstep(p.half * p.core, p.half + 0.25, segmentDistance(x, z, s.from, s.to)));
  wear *= p.strength * (1 - p.breakup + p.breakup * worldFbm(x, z, 1.6, 3, 271));
  const rim = isle.r - Math.hypot(x - isle.x, z - isle.z);
  let g = PARAMS.contact.strength * (1 - smoothstep(0, PARAMS.contact.band, rim));
  for (const t of TREE_PLACEMENTS) {
    const r = PARAMS.treeAo.base + PARAMS.treeAo.perM * t.heightM;
    g = Math.max(g, PARAMS.treeAo.strength * Math.exp(-((Math.hypot(x - t.x, z - t.z) / r) ** 2)));
  }
  const sp = PARAMS.specks;
  const speck = hash3(Math.floor(x / sp.cell), Math.floor(z / sp.cell), 281) < sp.share ? 1 : 0;
  const patch = smoothstep(sp.patchThreshold, sp.patchThreshold + 0.2, worldFbm(x, z, sp.patchCell, 3, 293));
  const b = speck * patch * sp.strength * (1 - wear) * smoothstep(0.2, 0.6, rim);
  return [wear, clamp01(g), b, worldFbm(x, z, PARAMS.macro.cell, PARAMS.macro.octaves, PARAMS.macro.seed)];
}

export function buildCloudsMask() {
  const dry = createWorldDryBand({
    zones: dryScreenZones(CLOUDS_DATA_SURFACES),
    wedges: themeWedges(CLOUDS_DATA_SURFACES),
    cameraBasis,
    wedgeHitsSphere,
    groundY: (x: number, z: number) => isleAt(x, z)?.top ?? 0,
  });
  return { ...rasterWorldMask({ layout: CLOUDS_MASK, fields: cloudsFields, dry }), dry };
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'clouds');
  ensureDir(dir);
  const t0 = Date.now();
  const raster = buildCloudsMask();
  const bytes = await encodeLosslessRgba(raster);
  const file = join(dir, 'mask.webp');
  writeFileSync(file, bytes);
  const forbidden = raster.forbidden.reduce((acc: number, v: number) => acc + v, 0);
  log(
    `clouds mask ${raster.size}² → ${file} ${Math.round(statSync(file).size / 1024)} KB in ${Date.now() - t0} ms; ` +
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
