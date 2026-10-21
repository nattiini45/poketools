/**
 * The plaza story mask (LOOK-PLAN §2 SEAT A.4): 512² RGBA over the 42 m
 * ground plane → `public/models/world/env/plaza/mask.webp` (LOSSLESS WebP,
 * so the keep-out zeros in B survive the encode bit-exactly).
 *
 *   R  wear lanes      `laneWear`      (medallion ring, spokes, promenade)
 *   G  contact grime   `contactGrime`  (façade line, furniture, lamp feet, kerb)
 *   B  puddles         `puddleField`, FORCED 0 inside every keep-out wedge
 *                      (`themeWedges`) and the dry band (`createDryBand`),
 *                      both dilated by PUDDLE_MARGIN_M
 *   A  macro noise     `macroNoise`    (anti-tiling index, 64 levels)
 *
 * All fields and the solver live in `src/lib/route-world/plaza-ground.ts`
 * (shared with the ground shader and the tests); this script only rasterises.
 * Deterministic: pure integer-hash noise, no Math.random, no clocks — the
 * same bytes on every run (the bake determinism test hashes both the raw
 * raster and the encoded file).
 *
 * Texel (col, row) covers world x = −21 + (col + ½)·42/512, z = −21 + (row + ½)·42/512
 * (row 0 = north edge = UV v 1; see `worldToMaskUv`).
 *
 * Usage: npx tsx scripts/world-assets/bake-plaza-mask.mts [--out]
 */

import { createHash } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { PLAZA_DATA_SURFACES } from '../../src/components/world/evoliga/route/plaza/data-faces';
import type { DataSurfaceTheme } from '../../src/lib/route-world/data-surfaces';
import {
  contactGrime,
  createDryBand,
  laneWear,
  macroNoise,
  maskTexelToWorld,
  PLAZA_MASK,
  PUDDLE_MARGIN_M,
  puddleField,
} from '../../src/lib/route-world/plaza-ground';

export interface PlazaMaskRaster {
  size: number;
  /** RGBA, row 0 = north edge. */
  data: Uint8Array;
  /** Texels whose puddle value was forced to 0 (dry band ∪ wedges, dilated). */
  forbidden: Uint8Array;
}

/** Macro-noise quantisation (A): 64 levels. */
export const MACRO_LEVELS = 63;

function toByte(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/** Chebyshev dilation of a binary raster by `radius` texels. */
function dilate(src: Uint8Array, size: number, radius: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let v = 0;
      for (let d = -radius; d <= radius && !v; d += 1) {
        const xx = x + d;
        if (xx >= 0 && xx < size && src[y * size + xx]) v = 1;
      }
      tmp[y * size + x] = v;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let v = 0;
      for (let d = -radius; d <= radius && !v; d += 1) {
        const yy = y + d;
        if (yy >= 0 && yy < size && tmp[yy * size + x]) v = 1;
      }
      out[y * size + x] = v;
    }
  }
  return out;
}

/** Rasterise the story mask for a world's data surfaces (the plaza's by default). */
export function buildPlazaMask(theme: DataSurfaceTheme = PLAZA_DATA_SURFACES): PlazaMaskRaster {
  const size = PLAZA_MASK.size;
  const band = createDryBand(theme);
  const raw = new Uint8Array(size * size);
  const q = PLAZA_MASK.texelM / 4;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const [x, z] = maskTexelToWorld(col, row);
      // 2×2 supersampling for the dry band, texel centre for the wedges (dilation covers the rest).
      const dry =
        band.isDry(x - q, z - q) || band.isDry(x + q, z - q) || band.isDry(x - q, z + q) || band.isDry(x + q, z + q);
      raw[row * size + col] = dry || band.inWedge(x, z) ? 1 : 0;
    }
  }
  const forbidden = dilate(raw, size, 1 + Math.ceil(PUDDLE_MARGIN_M / PLAZA_MASK.texelM));
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const [x, z] = maskTexelToWorld(col, row);
      const i = (row * size + col) * 4;
      data[i] = toByte(laneWear(x, z));
      data[i + 1] = toByte(contactGrime(x, z));
      data[i + 2] = forbidden[row * size + col] ? 0 : toByte(puddleField(x, z));
      // 64 levels: bilinear filtering restores the gradient; the lossless encode halves (§5.1 ≤ 90 KB).
      data[i + 3] = Math.round(Math.round(Math.min(1, Math.max(0, macroNoise(x, z))) * MACRO_LEVELS) * (255 / MACRO_LEVELS));
    }
  }
  return { size, data, forbidden };
}

/** Lossless WebP of the raster (alpha exact: `exact` keeps RGB under A = 0). */
export async function encodePlazaMask(raster: PlazaMaskRaster): Promise<Buffer> {
  return sharp(Buffer.from(raster.data), { raw: { width: raster.size, height: raster.size, channels: 4 } })
    .webp({ lossless: true, exact: true, effort: 6 })
    .toBuffer();
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'plaza');
  ensureDir(dir);
  const t0 = Date.now();
  const raster = buildPlazaMask();
  const bytes = await encodePlazaMask(raster);
  const file = join(dir, 'mask.webp');
  writeFileSync(file, bytes);
  const forbidden = raster.forbidden.reduce((s, v) => s + v, 0);
  let puddles = 0;
  for (let i = 2; i < raster.data.length; i += 4) if (raster.data[i] > 0) puddles += 1;
  log(
    `plaza mask ${raster.size}² → ${file} ${Math.round(statSync(file).size / 1024)} KB in ${Date.now() - t0} ms; ` +
      `dry+wedge texels ${((100 * forbidden) / (raster.size * raster.size)).toFixed(1)} %, puddle texels ${((100 * puddles) / (raster.size * raster.size)).toFixed(1)} %; ` +
      `raw sha256 ${sha256(raster.data).slice(0, 16)}, file sha256 ${sha256(bytes).slice(0, 16)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
