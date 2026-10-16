#!/usr/bin/env node
/**
 * Offline painterly bake of the plaza's three surface sets (LOOK-PLAN §2
 * SEAT A.3, the P2 recipe). Sharp raw buffers, every filter TOROIDAL (the
 * maps tile), deterministic (same bytes on re-run).
 *
 *   plaza-ground  ← cobblestone_floor_08  diff 1024 q84 + nor 1024 q88 (ARM dropped:
 *                   AO lives in the albedo, roughness is derived in-shader)
 *                   Kuwahara r6 → r3 · 5-stop value ramp (30 % chroma kept) ·
 *                   soft 7-band quantise mixed 0.3 · cavity from the 1k
 *                   Displacement (−38 % max, cool) · convex edge (+14 %, warm) ·
 *                   normal Kuwahara r2 + 1.2 px blur
 *   plaza-ashlar  ← plaster_grey_04       diff 1024 · nor + arm 512
 *                   grain only: macro blotch removed (high-pass), light
 *                   Kuwahara r2, gentle ramp (coursing is procedural in-material)
 *   plaza-slate   ← roof_slates_03        diff 1024 · nor + arm 512
 *                   Kuwahara r3, ramp, sky-lit top-edge lift from the normal map
 *
 * Inputs are the Poly Haven originals cached by `env-assets.mjs` (run it
 * first; the displacement is cache-only). Outputs land in the local mirror at
 * `public/models/world/env/tex/<role>/` (D20) — or `out/env/tex/` with
 * `--out`. The old `cobble` / `limestone` / `slate` sets are left on disk for
 * rollback. `--crops` also writes 1:1 review crops to the scratch dir given.
 *
 * ROLLOUT (ROLLOUT-PLAN §3.3 / §5): `--world sakura|mountain|clouds|all`
 * bakes that world's first-pass sets from `ROLLOUT_SETS` with the SAME plaza
 * recipe (Kuwahara r ≤ 6, value ramp at 30 % chroma keep, cavity and convex
 * edge from the cache-only 1k Displacement) — only the per-set parameter
 * block (ramp stops, radii, sizes) differs. Without `--world` only the three
 * plaza sets are baked, exactly as before. Inputs come from
 * `env-assets.mjs --rollout` (cache only). Deterministic: `renderRolloutSet`
 * returns the encoded bytes and the bake test hashes them.
 *
 * Usage: node scripts/world-assets/paint-bake.mjs [--out] [--crops <dir>]
 *        node scripts/world-assets/paint-bake.mjs --world sakura [--out] [--crops <dir>]
 * Then:  node scripts/world-assets/env-assets.mjs --mirror --gainmap   (refreshes ATTRIBUTION.md)
 *        (rollout: node scripts/world-assets/env-assets.mjs --mirror --attribution)
 *        node scripts/world-assets/bake-manifest.mjs --refresh-mirror
 * Windows: PowerShell or MSYS_NO_PATHCONV=1 (Git Bash rewrites /paths).
 */

import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } from './lib.mjs';
import { PH_CACHE, TEXTURES } from './env-assets.mjs';

const toOut = process.argv.includes('--out');
const worldArg = process.argv.indexOf('--world');
const WORLD = worldArg > 0 ? process.argv[worldArg + 1] : null;
const cropsArg = process.argv.indexOf('--crops');
const CROPS_DIR = cropsArg > 0 ? process.argv[cropsArg + 1] : null;
const ENV_TEX = join(toOut ? OUT_ENV_DIR : join(MIRROR_DIR, 'env'), 'tex');

// ── Image helpers (Float32 planar-interleaved RGB in 0..1, sRGB-encoded) ────

/** Read an image as { w, h, c, data: Float32Array } (values 0..1). */
async function readImage(file, channels = 3) {
  const img = sharp(file).removeAlpha();
  const meta = await sharp(file).metadata();
  const sixteen = meta.depth === 'ushort';
  const { data, info } = await (sixteen ? img.raw({ depth: 'ushort' }) : img.raw()).toBuffer({ resolveWithObject: true });
  const src = sixteen ? new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2) : data;
  const max = sixteen ? 65535 : 255;
  const w = info.width;
  const h = info.height;
  const out = new Float32Array(w * h * channels);
  for (let i = 0; i < w * h; i += 1) {
    for (let c = 0; c < channels; c += 1) out[i * channels + c] = src[i * info.channels + Math.min(c, info.channels - 1)] / max;
  }
  return { w, h, c: channels, data: out };
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Nearest-integer toroidal index. */
function wrap(v, n) {
  return ((v % n) + n) % n;
}

/**
 * Toroidal Kuwahara via summed-area tables: each pixel takes the mean colour
 * of whichever of its four (r+1)² quadrants has the lowest luminance variance.
 */
function kuwahara(img, r) {
  const { w, h, c, data } = img;
  const pw = w + 2 * r + 1;
  const ph = h + 2 * r + 1;
  // SAT over the wrapped, padded image: channels 0..c-1, then L, then L².
  const k = c + 2;
  const sat = new Float64Array(pw * ph * k);
  for (let y = 1; y < ph; y += 1) {
    const sy = wrap(y - 1 - r, h);
    for (let x = 1; x < pw; x += 1) {
      const sx = wrap(x - 1 - r, w);
      const si = (sy * w + sx) * c;
      const L = c >= 3 ? luma(data[si], data[si + 1], data[si + 2]) : data[si];
      const o = (y * pw + x) * k;
      const up = ((y - 1) * pw + x) * k;
      const left = (y * pw + x - 1) * k;
      const diag = ((y - 1) * pw + x - 1) * k;
      for (let ch = 0; ch < k; ch += 1) {
        const v = ch < c ? data[si + ch] : ch === c ? L : L * L;
        sat[o + ch] = v + sat[up + ch] + sat[left + ch] - sat[diag + ch];
      }
    }
  }
  const box = (x0, y0, x1, y1, ch) =>
    sat[((y1 + 1) * pw + x1 + 1) * k + ch] - sat[(y0 * pw + x1 + 1) * k + ch] - sat[((y1 + 1) * pw + x0) * k + ch] + sat[(y0 * pw + x0) * k + ch];
  const out = new Float32Array(data.length);
  const n = (r + 1) * (r + 1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // Padded coords of the pixel: (x + r, y + r).
      const px = x + r;
      const py = y + r;
      let best = Infinity;
      let bx = 0;
      let by = 0;
      for (const [qx, qy] of [
        [px - r, py - r],
        [px, py - r],
        [px - r, py],
        [px, py],
      ]) {
        const mean = box(qx, qy, qx + r, qy + r, c) / n;
        const variance = box(qx, qy, qx + r, qy + r, c + 1) / n - mean * mean;
        if (variance < best) {
          best = variance;
          bx = qx;
          by = qy;
        }
      }
      const o = (y * w + x) * c;
      for (let ch = 0; ch < c; ch += 1) out[o + ch] = box(bx, by, bx + r, by + r, ch) / n;
    }
  }
  return { w, h, c, data: out };
}

/** Separable toroidal Gaussian blur (sigma in px). */
function blur(img, sigma) {
  const { w, h, c, data } = img;
  const r = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let sum = 0;
  for (let i = -r; i <= r; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  const tmp = new Float32Array(data.length);
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        let acc = 0;
        for (let i = -r; i <= r; i += 1) acc += data[(y * w + wrap(x + i, w)) * c + ch] * kernel[i + r];
        tmp[(y * w + x) * c + ch] = acc;
      }
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        let acc = 0;
        for (let i = -r; i <= r; i += 1) acc += tmp[(wrap(y + i, h) * w + x) * c + ch] * kernel[i + r];
        out[(y * w + x) * c + ch] = acc;
      }
    }
  }
  return { w, h, c, data: out };
}

function hex(color) {
  const v = Number.parseInt(color.slice(1), 16);
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Soft N-band quantiser: each band edge is a smoothstep `soft` of a band wide. */
function softQuantise(v, bands, soft = 0.35) {
  const s = v * bands;
  const i = Math.floor(s);
  const f = s - i;
  const edge = smoothstep(0.5 - soft / 2, 0.5 + soft / 2, f);
  return Math.min(1, (i + edge) / bands);
}

function quantileOf(values, q) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * The painterly value ramp: luminance is normalised over its p2..p98 range,
 * soft-quantised (7 bands) and mixed back at `quantMix`, mapped through a
 * 5-stop cool-dark → warm-light ramp, and the source chroma is kept at
 * `chromaKeep`. The result is re-scaled so its mean luminance matches the
 * source (the value STRUCTURE changes, the albedo level does not).
 */
function paintRamp(img, { stops, chromaKeep, quantMix, bands = 7 }) {
  const { w, h, c, data } = img;
  const n = w * h;
  const L = new Float32Array(n);
  let srcMean = 0;
  for (let i = 0; i < n; i += 1) {
    L[i] = luma(data[i * c], data[i * c + 1], data[i * c + 2]);
    srcMean += L[i] / n;
  }
  const lo = quantileOf(L, 0.02);
  const hi = quantileOf(L, 0.98);
  const cols = stops.map(hex);
  const out = new Float32Array(data.length);
  let outMean = 0;
  for (let i = 0; i < n; i += 1) {
    let t = Math.min(1, Math.max(0, (L[i] - lo) / Math.max(1e-4, hi - lo)));
    t = t * (1 - quantMix) + softQuantise(t, bands) * quantMix;
    const s = t * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(s));
    const f = s - k;
    for (let ch = 0; ch < 3; ch += 1) {
      const ramp = cols[k][ch] * (1 - f) + cols[k + 1][ch] * f;
      out[i * c + ch] = ramp + (data[i * c + ch] - L[i]) * chromaKeep;
    }
    outMean += luma(out[i * c], out[i * c + 1], out[i * c + 2]) / n;
  }
  const gain = srcMean / Math.max(1e-4, outMean);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.min(1, Math.max(0, out[i] * gain));
  return { w, h, c, data: out };
}

/** Local relief of a height map: height minus its Gaussian surround, normalised by its p99 magnitude. */
function relief(height, sigma) {
  const surround = blur(height, sigma);
  const d = new Float32Array(height.data.length);
  const mags = new Float32Array(height.data.length);
  for (let i = 0; i < d.length; i += 1) {
    d[i] = height.data[i] - surround.data[i];
    mags[i] = Math.abs(d[i]);
  }
  const scale = Math.max(1e-5, quantileOf(mags, 0.99));
  for (let i = 0; i < d.length; i += 1) d[i] = Math.max(-1, Math.min(1, d[i] / scale));
  return d;
}

/** Re-normalise a tangent-space normal map (0..1 encoded). */
function renormalise(img) {
  const { data, c } = img;
  for (let i = 0; i < data.length; i += c) {
    const x = data[i] * 2 - 1;
    const y = data[i + 1] * 2 - 1;
    const z = Math.max(0, data[i + 2] * 2 - 1);
    const len = Math.hypot(x, y, z) || 1;
    data[i] = (x / len + 1) / 2;
    data[i + 1] = (y / len + 1) / 2;
    data[i + 2] = (z / len + 1) / 2;
  }
  return img;
}

function toBuffer(img) {
  const buf = Buffer.alloc(img.w * img.h * img.c);
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.round(Math.min(1, Math.max(0, img.data[i])) * 255);
  return buf;
}

async function writeWebp(img, file, { quality, size, lossless = false }) {
  let pipe = sharp(toBuffer(img), { raw: { width: img.w, height: img.h, channels: img.c } });
  if (size && size !== img.w) pipe = pipe.resize(size, size, { kernel: 'lanczos3' });
  await pipe.webp({ quality, effort: 6, smartSubsample: true, lossless }).toFile(file);
  return Math.round(statSync(file).size / 1024);
}

/** The same encode as `writeWebp`, to a Buffer (the rollout sets; hashed by the bake test). */
async function encodeWebp(img, { quality, size }) {
  let pipe = sharp(toBuffer(img), { raw: { width: img.w, height: img.h, channels: img.c } });
  if (size && size !== img.w) pipe = pipe.resize(size, size, { kernel: 'lanczos3' });
  return pipe.webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
}

async function writeCrop(img, name) {
  if (!CROPS_DIR) return;
  ensureDir(CROPS_DIR);
  await sharp(toBuffer(img), { raw: { width: img.w, height: img.h, channels: img.c } })
    .extract({ left: 256, top: 256, width: 384, height: 384 })
    .png()
    .toFile(join(CROPS_DIR, `${name}.png`));
}

function source(id, map, ext = 'jpg') {
  const file = join(PH_CACHE, `${id}_${map}_1k.${ext}`);
  if (!existsSync(file)) throw new Error(`missing ${file} — run env-assets.mjs --mirror first`);
  return file;
}

// ── The three sets ──────────────────────────────────────────────────────────

/** Painterly ground recipe (P2). Exported for tests. */
export const GROUND = {
  kuwahara: [6, 3],
  /** Post-Kuwahara soften (px): rounds the filter's square-quadrant block edges. */
  soften: 0.7,
  stops: ['#4a4a53', '#6a6868', '#8a857e', '#a89f92', '#c4baa9'],
  chromaKeep: 0.3,
  quantMix: 0.3,
  cavity: { max: 0.38, sigma: 6, tint: [1.0, 0.94, 0.82] },
  edge: { max: 0.14, sigma: 6, tint: [1.0, 0.9, 0.72] },
  normal: { kuwahara: 2, blur: 1.2 },
  diff: { quality: 84, size: 1024 },
  nor: { quality: 88, size: 1024 },
};

async function bakeGround() {
  const id = TEXTURES.cobble;
  const dir = join(ENV_TEX, 'plaza-ground');
  ensureDir(dir);
  let diff = await readImage(source(id, 'diff'));
  await writeCrop(diff, 'ground-source');
  for (const r of GROUND.kuwahara) diff = kuwahara(diff, r);
  diff = paintRamp(blur(diff, GROUND.soften), GROUND);
  // Cavity (darken, cool: blue kept most) and convex edge (lift, warm: red lifted most).
  const height = await readImage(source(id, 'disp', 'png'), 1);
  const cav = relief(height, GROUND.cavity.sigma);
  for (let i = 0; i < diff.w * diff.h; i += 1) {
    const cavity = Math.max(0, -cav[i]);
    const convex = Math.max(0, cav[i]);
    for (let ch = 0; ch < 3; ch += 1) {
      const dark = 1 - GROUND.cavity.max * cavity * GROUND.cavity.tint[ch];
      const lift = 1 + GROUND.edge.max * convex * GROUND.edge.tint[ch];
      diff.data[i * 3 + ch] = Math.min(1, diff.data[i * 3 + ch] * dark * lift);
    }
  }
  await writeCrop(diff, 'ground-painted');
  let nor = await readImage(source(id, 'nor'));
  nor = renormalise(blur(kuwahara(nor, GROUND.normal.kuwahara), GROUND.normal.blur));
  const a = await writeWebp(diff, join(dir, 'diff.webp'), GROUND.diff);
  const b = await writeWebp(nor, join(dir, 'nor.webp'), GROUND.nor);
  log(`plaza-ground: diff ${a} KB + nor ${b} KB (arm dropped)`);
  return a + b;
}

export const ASHLAR = {
  macroSigma: 24,
  /** Share of the high-passed grain kept: the wall stays calm behind data faces. */
  grain: 0.45,
  kuwahara: 3,
  stops: ['#8f887d', '#a39b8e', '#b4ab9d', '#c3b9a9', '#d0c6b5'],
  chromaKeep: 0.3,
  quantMix: 0.15,
  diff: { quality: 84, size: 1024 },
  nor: { quality: 88, size: 512 },
  arm: { quality: 86, size: 512 },
};

async function bakeAshlar() {
  const id = TEXTURES.limestone;
  const dir = join(ENV_TEX, 'plaza-ashlar');
  ensureDir(dir);
  const src = await readImage(source(id, 'diff'));
  // Grain only: remove the macro blotch (the "camouflage" read) around the mean.
  const macro = blur(src, ASHLAR.macroSigma);
  const mean = [0, 1, 2].map((ch) => {
    let s = 0;
    for (let i = ch; i < src.data.length; i += 3) s += src.data[i];
    return s / (src.w * src.h);
  });
  const grain = { ...src, data: new Float32Array(src.data.length) };
  for (let i = 0; i < src.data.length; i += 1) grain.data[i] = mean[i % 3] + (src.data[i] - macro.data[i]) * ASHLAR.grain;
  let diff = kuwahara(grain, ASHLAR.kuwahara);
  diff = paintRamp(diff, ASHLAR);
  await writeCrop(diff, 'ashlar-painted');
  const nor = renormalise(await readImage(source(id, 'nor')));
  const arm = await readImage(source(id, 'arm'));
  const a = await writeWebp(diff, join(dir, 'diff.webp'), ASHLAR.diff);
  const b = await writeWebp(nor, join(dir, 'nor.webp'), ASHLAR.nor);
  const c = await writeWebp(arm, join(dir, 'arm.webp'), ASHLAR.arm);
  log(`plaza-ashlar: diff ${a} KB + nor ${b} KB + arm ${c} KB`);
  return a + b + c;
}

export const SLATE = {
  kuwahara: 3,
  stops: ['#262a33', '#3a3e49', '#50555f', '#666a74', '#7c808a'],
  chromaKeep: 0.2,
  quantMix: 0.3,
  /** Top-edge lift from tangent-space normal +Y (faces tilted toward the sky), cool sky tint. */
  skyLift: { max: 0.16, tint: [0.86, 0.94, 1.0] },
  diff: { quality: 84, size: 1024 },
  nor: { quality: 88, size: 512 },
  arm: { quality: 86, size: 512 },
};

async function bakeSlate() {
  const id = TEXTURES.slate;
  const dir = join(ENV_TEX, 'plaza-slate');
  ensureDir(dir);
  let diff = kuwahara(await readImage(source(id, 'diff')), SLATE.kuwahara);
  diff = paintRamp(diff, SLATE);
  const nor = await readImage(source(id, 'nor'));
  // nor_gl: +Y (green) points up the texture — the slate's exposed top edge on a pitched roof.
  const soft = blur(nor, 1.5);
  for (let i = 0; i < diff.w * diff.h; i += 1) {
    const ny = soft.data[i * 3 + 1] * 2 - 1;
    const lift = SLATE.skyLift.max * smoothstep(0.05, 0.45, ny);
    for (let ch = 0; ch < 3; ch += 1) {
      diff.data[i * 3 + ch] = Math.min(1, diff.data[i * 3 + ch] * (1 + lift * SLATE.skyLift.tint[ch]));
    }
  }
  await writeCrop(diff, 'slate-painted');
  const arm = await readImage(source(id, 'arm'));
  const a = await writeWebp(diff, join(dir, 'diff.webp'), SLATE.diff);
  const b = await writeWebp(renormalise(nor), join(dir, 'nor.webp'), SLATE.nor);
  const c = await writeWebp(arm, join(dir, 'arm.webp'), SLATE.arm);
  log(`plaza-slate: diff ${a} KB + nor ${b} KB + arm ${c} KB`);
  return a + b + c;
}

// ── Rollout sets (ROLLOUT-PLAN §5) ──────────────────────────────────────────

/**
 * Per-set parameter blocks. `kind`:
 *   ground  the plaza-ground recipe: Kuwahara (r ≤ 6) → soften → ramp →
 *           cavity (cool darken) and convex edge (warm lift) from the
 *           cache-only Displacement → normal Kuwahara + blur
 *   grain   the plaza-ashlar recipe: macro blotch removed (high-pass around
 *           the mean), light Kuwahara, gentle ramp — the material adds form
 *   normal  normal map only (the albedo is procedural in-material)
 * `stops` run cool-dark → warm-light; `paintRamp` re-scales the result to the
 * source's mean luminance, so the stops set hue and value STRUCTURE, never
 * the albedo level. From B5 each AD owns its world's blocks (re-bake +
 * `bake-manifest.mjs --refresh-mirror`); the recipe functions stay frozen.
 */
export const ROLLOUT_SETS = {
  sakura: [
    {
      role: 'sakura-lawn',
      source: 'aerial_grass_rock',
      kind: 'ground',
      kuwahara: [6, 3],
      soften: 1.2,
      // Fresh spring green; the darks lean blue-green (lilac shade is a light term, never teal albedo).
      stops: ['#2f4436', '#46603a', '#61803f', '#80a04c', '#a6bd68'],
      chromaKeep: 0.3,
      quantMix: 0.3,
      cavity: { max: 0.3, sigma: 6, tint: [1.0, 0.95, 0.86] },
      edge: { max: 0.1, sigma: 6, tint: [1.0, 0.94, 0.78] },
      normal: { kuwahara: 2, blur: 1.2 },
      diff: { quality: 84, size: 1024 },
      nor: { quality: 86, size: 1024 },
    },
    {
      role: 'sakura-gravel',
      source: 'gravel_floor_02',
      kind: 'ground',
      kuwahara: [6, 3],
      soften: 1.0,
      // Raked pale granite gravel, warm in the lights.
      stops: ['#66676d', '#817f7e', '#9c9892', '#b6b0a6', '#cdc6b9'],
      chromaKeep: 0.3,
      quantMix: 0.3,
      cavity: { max: 0.34, sigma: 5, tint: [1.0, 0.95, 0.85] },
      edge: { max: 0.12, sigma: 5, tint: [1.0, 0.92, 0.76] },
      normal: { kuwahara: 2, blur: 1.2 },
      diff: { quality: 76, size: 1024 },
      nor: { quality: 84, size: 512 },
    },
    {
      role: 'stone-grain',
      source: 'rock_wall_08',
      kind: 'grain',
      macroSigma: 24,
      grain: 0.5,
      kuwahara: 3,
      // Neutral grey: painted-stone tints per world in-material (granite, dry-stone).
      stops: ['#7a7b7f', '#8d8d8e', '#9f9e9b', '#b0ada8', '#c0bcb4'],
      chromaKeep: 0.3,
      quantMix: 0.15,
      normal: { kuwahara: 2, blur: 1.0 },
      diff: { quality: 84, size: 1024 },
      nor: { quality: 88, size: 512 },
    },
    {
      role: 'sakura-planks',
      source: 'weathered_brown_planks',
      kind: 'grain',
      macroSigma: 32,
      grain: 0.7,
      kuwahara: 2,
      // Weathered cedar deck.
      stops: ['#4a3b31', '#644f40', '#7e6650', '#977d62', '#ae9577'],
      chromaKeep: 0.3,
      quantMix: 0.15,
      normal: { kuwahara: 1, blur: 0.8 },
      diff: { quality: 84, size: 512 },
      nor: { quality: 86, size: 512 },
    },
  ],
  mountain: [
    {
      role: 'mountain-meadow',
      source: 'forrest_ground_01',
      kind: 'ground',
      kuwahara: [6, 3],
      soften: 1.2,
      // Alpine meadow: cool green darks, straw-gold lights (heather accents are mask/material work).
      stops: ['#33453b', '#4b6341', '#657d47', '#879754', '#abad6e'],
      chromaKeep: 0.3,
      quantMix: 0.3,
      cavity: { max: 0.32, sigma: 6, tint: [1.0, 0.95, 0.86] },
      edge: { max: 0.1, sigma: 6, tint: [1.0, 0.94, 0.8] },
      normal: { kuwahara: 2, blur: 1.2 },
      diff: { quality: 84, size: 1024 },
      nor: { quality: 80, size: 1024 },
    },
    {
      role: 'mountain-granite',
      source: 'rock_face',
      kind: 'ground',
      kuwahara: [5, 3],
      soften: 0.6,
      // Cool granite: blue-grey shade, pale warm-grey lights (cobalt shade is a light term).
      stops: ['#4a505d', '#626874', '#7b8089', '#95989e', '#b0b0b1'],
      chromaKeep: 0.3,
      quantMix: 0.3,
      cavity: { max: 0.36, sigma: 6, tint: [1.0, 0.96, 0.9] },
      edge: { max: 0.14, sigma: 6, tint: [1.0, 0.95, 0.86] },
      normal: { kuwahara: 2, blur: 1.2 },
      diff: { quality: 84, size: 1024 },
      nor: { quality: 86, size: 1024 },
    },
    {
      role: 'mountain-snow',
      source: 'snow_02',
      kind: 'normal',
      normal: { kuwahara: 2, blur: 1.4 },
      nor: { quality: 86, size: 512 },
    },
  ],
  clouds: [
    {
      role: 'clouds-cap',
      source: 'aerial_grass_rock',
      kind: 'ground',
      kuwahara: [6, 3],
      soften: 1.2,
      // Sea-green isle meadow.
      stops: ['#2e4a45', '#426651', '#58815b', '#759f69', '#9bbd82'],
      chromaKeep: 0.3,
      quantMix: 0.3,
      cavity: { max: 0.3, sigma: 6, tint: [1.0, 0.96, 0.9] },
      edge: { max: 0.1, sigma: 6, tint: [1.0, 0.95, 0.82] },
      normal: { kuwahara: 2, blur: 1.2 },
      diff: { quality: 84, size: 1024 },
      nor: { quality: 86, size: 512 },
    },
    {
      role: 'clouds-strata',
      source: 'plaster_grey_04',
      kind: 'grain',
      macroSigma: 24,
      grain: 0.5,
      kuwahara: 3,
      // Cream limestone (azure shade is a light term).
      stops: ['#a49a88', '#b5ab97', '#c4baa5', '#d2c8b2', '#ded5c0'],
      chromaKeep: 0.3,
      quantMix: 0.15,
      normal: { kuwahara: 0, blur: 0 },
      diff: { quality: 84, size: 1024 },
      nor: { quality: 88, size: 512 },
    },
  ],
};

/** Every rollout set, flat, with its world. */
export function rolloutSets(world = 'all') {
  const worlds = world === 'all' ? Object.keys(ROLLOUT_SETS) : [world];
  return worlds.flatMap((w) => {
    if (!ROLLOUT_SETS[w]) throw new Error(`unknown world ${w} (sakura | mountain | clouds | all)`);
    return ROLLOUT_SETS[w].map((set) => ({ world: w, ...set }));
  });
}

/** Grain-only albedo (the ashlar recipe): remove the macro blotch around the channel means. */
function grainOnly(src, macroSigma, amount) {
  const macro = blur(src, macroSigma);
  const mean = [0, 1, 2].map((ch) => {
    let sum = 0;
    for (let i = ch; i < src.data.length; i += 3) sum += src.data[i];
    return sum / (src.w * src.h);
  });
  const out = { ...src, data: new Float32Array(src.data.length) };
  for (let i = 0; i < src.data.length; i += 1) out.data[i] = mean[i % 3] + (src.data[i] - macro.data[i]) * amount;
  return out;
}

/** Cavity (cool darken) and convex edge (warm lift) from a height map, in place. */
function applyCavity(diff, height, set) {
  const cav = relief(height, set.cavity.sigma);
  for (let i = 0; i < diff.w * diff.h; i += 1) {
    const cavity = Math.max(0, -cav[i]);
    const convex = Math.max(0, cav[i]);
    for (let ch = 0; ch < 3; ch += 1) {
      const dark = 1 - set.cavity.max * cavity * set.cavity.tint[ch];
      const lift = 1 + set.edge.max * convex * set.edge.tint[ch];
      diff.data[i * 3 + ch] = Math.min(1, diff.data[i * 3 + ch] * dark * lift);
    }
  }
  return diff;
}

/**
 * Render one rollout set to encoded WebP bytes ({ diff?, nor }) without
 * touching disk. Deterministic (pure maths + sharp's encoder).
 */
export async function renderRolloutSet(set, { crop = null } = {}) {
  const out = {};
  if (set.kind !== 'normal') {
    let diff = await readImage(source(set.source, 'diff'));
    if (crop) await crop(diff, `${set.role}-source`);
    if (set.kind === 'grain') {
      diff = paintRamp(kuwahara(grainOnly(diff, set.macroSigma, set.grain), set.kuwahara), set);
    } else {
      for (const r of set.kuwahara) diff = kuwahara(diff, r);
      diff = paintRamp(blur(diff, set.soften), set);
      if (set.cavity) applyCavity(diff, await readImage(source(set.source, 'disp'), 1), set);
    }
    if (crop) await crop(diff, `${set.role}-painted`);
    out.diff = await encodeWebp(diff, set.diff);
  }
  let nor = await readImage(source(set.source, 'nor'));
  if (set.normal.kuwahara > 0) nor = kuwahara(nor, set.normal.kuwahara);
  if (set.normal.blur > 0) nor = blur(nor, set.normal.blur);
  out.nor = await encodeWebp(renormalise(nor), set.nor);
  return out;
}

async function bakeRollout(world) {
  const totals = {};
  for (const set of rolloutSets(world)) {
    const dir = join(ENV_TEX, set.role);
    ensureDir(dir);
    const bytes = await renderRolloutSet(set, { crop: CROPS_DIR ? writeCrop : null });
    const parts = [];
    for (const [map, buf] of Object.entries(bytes)) {
      writeFileSync(join(dir, `${map}.webp`), buf);
      parts.push(`${map} ${Math.round(buf.length / 1024)} KB`);
      totals[set.world] = (totals[set.world] ?? 0) + buf.length;
    }
    log(`${set.world} ${set.role} ← ${set.source}: ${parts.join(' + ')}`);
  }
  for (const [w, b] of Object.entries(totals)) log(`${w}: painted sets ${Math.round(b / 1024)} KB`);
}

async function main() {
  if (WORLD) {
    await bakeRollout(WORLD);
    log('→ run env-assets.mjs --mirror --attribution, then bake-manifest.mjs --refresh-mirror');
    return;
  }
  const total = (await bakeGround()) + (await bakeAshlar()) + (await bakeSlate());
  log(`painted sets: ${total} KB → run env-assets.mjs --mirror --gainmap (attribution), then bake-manifest.mjs --refresh-mirror`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
