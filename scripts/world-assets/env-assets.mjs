#!/usr/bin/env node
/**
 * Step 2b — environment assets: CC0 HDRIs and PBR texture sets from Poly Haven.
 *
 * Resolves exact file URLs through the Poly Haven API (no guessed paths),
 * caches the originals under .cache/polyhaven/, and writes:
 *
 *   <env>/hdri/<role>.hdr             1k Radiance HDR (rollback source)
 *   <env>/hdri/<role>.jpg             UltraHDR gain-map JPEG (`--gainmap`; what the app loads)
 *   <env>/tex/<role>/{diff,nor,arm}.ktx2   KTX2 (ETC1S colour, UASTC data)
 *   <env>/ATTRIBUTION.md              per-asset source + licence (+ derived-work notes)
 *
 * `<env>` is `out/env` by default, or the local mirror `public/models/world/env`
 * with `--mirror` (D20: the plaza pilot writes the mirror directly; `out/` is
 * the Supabase publishing staging area and is NOT touched then).
 *
 * KTX2 needs the KTX-Software `toktx` binary (see README.md). Without it the
 * maps are written as WebP at the same paths with a .webp extension and the
 * app's texture hook picks whichever exists in the manifest.
 *
 * CACHE-ONLY sources (LOOK-PLAN §5.2): maps the painterly bake reads but the
 * app never loads — today the `cobblestone_floor_08` 1k Displacement (16-bit
 * PNG), the cavity/edge source for `paint-bake.mjs`. They land in
 * .cache/polyhaven only and are never shipped.
 *
 * Gain maps (LOOK-PLAN §2 SEAT A.1, `--gainmap`): each `.hdr` is re-encoded
 * on the CPU with the exact maths of @monogrid/gainmap-js's encoder/decoder
 * shaders (no WebGL needed): an sRGB SDR base (the HDR scaled so its p99.5
 * channel value maps to 1, then clipped) plus a half-resolution RGB recovery
 * map, assembled into one JPEG-R by `encodeJPEGMetadata` (pure JS in 3.4).
 * drei 10.7.7 `useEnvironment` routes `.jpg` through `HDRJPGLoader`. A probe
 * sphere (diffuse SH9 irradiance + a cos^32 glossy lobe, tone-mapped, CIE
 * ΔE) compares the decoded gain map against the original; the run fails
 * (exit 1) when either max ΔE reaches 3. The encode is deterministic (same
 * bytes on re-run).
 *
 * ROLLOUT sources (ROLLOUT-PLAN §5, `--rollout`): the CC0 originals the
 * sakura / mountain / clouds painterly bakes read (`ROLLOUT_SOURCES`). They
 * are downloaded to .cache/polyhaven ONLY — `--rollout` writes nothing under
 * the env dir; `paint-bake.mjs --world <w>` turns them into the shipped sets.
 * `--attribution` only rewrites ATTRIBUTION.md from what is on disk.
 * Run from PowerShell (or `MSYS_NO_PATHCONV=1`): Git Bash rewrites /paths.
 *
 * Usage: node scripts/world-assets/env-assets.mjs [--force] [--mirror] [--gainmap] [--probe-only]
 *        node scripts/world-assets/env-assets.mjs --rollout            (cache-only downloads)
 *        node scripts/world-assets/env-assets.mjs --mirror --attribution
 */

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { CACHE_DIR, MIRROR_DIR, OUT_ENV_DIR, ensureDir, findToktx, log, parallel } from './lib.mjs';

const force = process.argv.includes('--force');
const toMirror = process.argv.includes('--mirror');
const gainmap = process.argv.includes('--gainmap');
const probeOnly = process.argv.includes('--probe-only');
const rolloutOnly = process.argv.includes('--rollout');
const attributionOnly = process.argv.includes('--attribution');
export const PH_CACHE = join(CACHE_DIR, 'polyhaven');
const ENV_DIR = toMirror ? join(MIRROR_DIR, 'env') : OUT_ENV_DIR;
const API = 'https://api.polyhaven.com';

/** Role → Poly Haven asset id. Roles are what the app references; ids can be swapped here. */
export const HDRIS = {
  /** Golden-hour sky, clear horizon glow — matches the `gold` palette key. */
  gold: 'rosendal_park_sunset_puresky',
  /** Moonlit, partly cloudy — cool ambient for the `night` palette. */
  night: 'rogland_moonlit_night',
};

export const TEXTURES = {
  /** Plaza ground: grey granite setts. */
  cobble: 'cobblestone_floor_08',
  /** Haussmann ashlar: smooth grey plaster, tinted to Lutetian limestone in-material. */
  limestone: 'plaster_grey_04',
  /** Mansard roofs. */
  slate: 'roof_slates_03',
};

/**
 * `encode`: ETC1S is ~1 bpp and fine for albedo and AO/rough/metal packs;
 * normals keep UASTC (with RDO so zstd bites) because ETC1S banding shows as
 * lighting ripple on flat stone.
 */
const TEXTURE_MAPS = [
  { key: 'Diffuse', out: 'diff', srgb: true, encode: 'etc1s' },
  { key: 'nor_gl', out: 'nor', srgb: false, encode: 'uastc' },
  { key: 'arm', out: 'arm', srgb: false, encode: 'etc1s' },
];

/**
 * Cache-only sources (never shipped). `format` is the Poly Haven file format
 * key; the cached name is `<id>_<out>_<RES>.<format>`.
 */
export const CACHE_ONLY = [{ id: 'cobblestone_floor_08', key: 'Displacement', out: 'disp', format: 'png' }];

const RES = '1k';

/**
 * ROLLOUT-PLAN §5: the Poly Haven originals behind the sakura / mountain /
 * clouds painted sets (IDs verified on api.polyhaven.com 2026-09-28). Every
 * map is CACHE-ONLY (`<id>_<out>_1k.jpg` in .cache/polyhaven); nothing here
 * ships raw. `disp` is the cavity source of the bake (JPG, the §5 sizes).
 * `plaster_grey_04` (clouds strata) is already cached by the plaza's
 * `limestone` role. The optional day HDRIs are not fetched (D-R5: reuse
 * gold / night first).
 */
export const ROLLOUT_SOURCES = [
  { id: 'aerial_grass_rock', maps: ['diff', 'nor', 'disp'], use: 'sakura lawn and clouds isle cap' },
  { id: 'gravel_floor_02', maps: ['diff', 'nor', 'disp'], use: 'sakura raked gravel' },
  { id: 'rock_wall_08', maps: ['diff', 'nor'], use: 'the shared stone grain (sakura granite, mountain masonry)' },
  { id: 'weathered_brown_planks', maps: ['diff', 'nor'], use: 'the sakura bridge deck' },
  { id: 'forrest_ground_01', maps: ['diff', 'nor', 'disp'], use: 'the mountain meadow' },
  { id: 'rock_face', maps: ['diff', 'nor', 'disp'], use: 'the mountain crag granite' },
  { id: 'snow_02', maps: ['nor'], use: 'the mountain snow normal (albedo is procedural)' },
];

/** Poly Haven file key of each cached map name. */
const ROLLOUT_MAP_KEYS = { diff: 'Diffuse', nor: 'nor_gl', disp: 'Displacement' };

/** Download every `ROLLOUT_SOURCES` map (JPG) into the cache; returns the per-asset byte table. */
async function downloadRolloutSources() {
  ensureDir(PH_CACHE);
  const table = [];
  for (const src of ROLLOUT_SOURCES) {
    const files = await fetchJson(`${API}/files/${src.id}`);
    let bytes = 0;
    for (const out of src.maps) {
      const entry = files[ROLLOUT_MAP_KEYS[out]]?.[RES]?.jpg;
      if (!entry?.url) throw new Error(`no ${RES} ${ROLLOUT_MAP_KEYS[out]} jpg for ${src.id}`);
      const cached = cachedMapPath(src.id, out, 'jpg');
      const fresh = await download(entry.url, cached);
      if (statSync(cached).size !== entry.size) throw new Error(`${cached}: ${statSync(cached).size} B, the API says ${entry.size} B`);
      bytes += statSync(cached).size;
      log(`  cache-only ${src.id} ${out} → ${kb(cached)} KB${fresh ? '' : ' (cached)'}`);
    }
    table.push({ id: src.id, bytes });
  }
  const total = table.reduce((sum, t) => sum + t.bytes, 0);
  log(`rollout sources: ${table.length} assets, ${(total / 1024 / 1024).toFixed(2)} MB in ${PH_CACHE} (never shipped)`);
  return table;
}

/** Cached original for a texture map (`out` = diff | nor | arm | disp). */
export function cachedMapPath(id, out, ext = 'jpg') {
  return join(PH_CACHE, `${id}_${out}_${RES}.${ext}`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function download(url, file) {
  if (existsSync(file) && !force) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

function kb(file) {
  return Math.round(statSync(file).size / 1024);
}

function encodeKtx2(toktx, input, output, map) {
  const args = ['--t2', '--genmipmap', '--assign_oetf', map.srgb ? 'srgb' : 'linear'];
  if (map.encode === 'etc1s') {
    args.push('--encode', 'etc1s', '--clevel', '2', '--qlevel', map.srgb ? '160' : '192');
  } else {
    args.push('--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.0', '--zcmp', '18');
  }
  args.push(output, input);
  const result = spawnSync(toktx, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`toktx failed for ${input}: ${result.stderr || result.stdout}`);
  }
}

// ── Gain-map encode / decode (CPU mirror of @monogrid/gainmap-js 3.4 shaders) ──

/** Half-float ceiling: RGBELoader (HalfFloat) and the gain-map decoder both clamp here. */
const HALF_MAX = 65504;
/** Encoder defaults (gainmap-js GainMapEncoderMaterial). */
const GAINMAP_OFFSET_SDR = 1 / 64;
/**
 * Recovery-map encodings, cheapest first. The SDR base is always q85 (LOOK-PLAN).
 * `encodeGainmaps` ships the first one whose probe ΔE stays under
 * GAINMAP_TARGET_DE (a margin under the ΔE < 3 gate). `downscale` is the
 * recovery-map resolution divisor (the decoder samples it bilinearly).
 */
export const GAINMAP_CANDIDATES = [
  { downscale: 2, gain: 85, chroma: '4:2:0' },
  { downscale: 1, gain: 85, chroma: '4:4:4' },
  { downscale: 1, gain: 95, chroma: '4:4:4' },
];
const GAINMAP_SDR_QUALITY = 85;
const GAINMAP_TARGET_DE = 1.5;
/** Share of pixels allowed to clip in the SDR base (their energy lives in the gain map). */
const SDR_CLIP_QUANTILE = 0.995;
/**
 * Spike law (the night moon: 6 texels up to 153 000, clamped to 65 504, carry
 * 57 % of the map's irradiance). A texel brighter than SPIKE_RATIO × the p99.5
 * value is a point source no 8-bit recovery map can hold at one texel (JPEG
 * smears a lone code-255 texel and the exponential decode turns that into a
 * large energy error). Each connected spike is re-painted as a flat disc of
 * SPIKE_RADIUS texels carrying EXACTLY its excess radiant energy (solid-angle
 * weighted, per channel) — diffuse and glossy IBL are unchanged, a mirror
 * reflection shows a ≈ 1.4° soft disc instead of a 0.5° one.
 */
const SPIKE_RATIO = 64;
const SPIKE_RADIUS = 3;

function srgbEncode(x) {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function srgbDecode(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parse a Radiance `.hdr` into Float32 RGBA (three's HDRLoader, math only). */
export async function readHdr(file) {
  const THREE = await import('three');
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const loader = new HDRLoader();
  loader.setDataType(THREE.FloatType);
  const buf = readFileSync(file);
  const parsed = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const data = parsed.data;
  for (let i = 0; i < data.length; i += 1) data[i] = Math.min(HALF_MAX, data[i]);
  return { width: parsed.width, height: parsed.height, data };
}

function quantile(values, q) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/** Solid angle of an equirect texel row (relative units; only ratios matter). */
function rowWeight(y, height) {
  return Math.cos((0.5 - (y + 0.5) / height) * Math.PI);
}

/**
 * Energy-conserving spike spread (see SPIKE_RATIO). Returns a new image; the
 * input is not modified. Deterministic: components are visited in scan order.
 */
export function spreadSpikes(hdr) {
  const { width, height } = hdr;
  const data = Float32Array.from(hdr.data);
  const n = width * height;
  const maxes = new Float32Array(n);
  for (let i = 0; i < n; i += 1) maxes[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const threshold = SPIKE_RATIO * Math.max(1e-4, quantile(maxes, SDR_CLIP_QUANTILE));
  const seen = new Uint8Array(n);
  const spikes = [];
  for (let start = 0; start < n; start += 1) {
    if (seen[start] || maxes[start] <= threshold) continue;
    const stack = [start];
    const members = [];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      members.push(i);
      const x = i % width;
      const y = Math.floor(i / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          const j = ny * width + ((x + dx + width) % width);
          if (!seen[j] && maxes[j] > threshold) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    spikes.push(members.sort((a, b) => a - b));
  }
  for (const members of spikes) {
    // Background: median per channel of the 1-texel ring around the component.
    const inside = new Set(members);
    const ring = new Set();
    for (const i of members) {
      const x = i % width;
      const y = Math.floor(i / width);
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          const j = ny * width + ((x + dx + width) % width);
          if (!inside.has(j)) ring.add(j);
        }
      }
    }
    const ringList = [...ring].sort((a, b) => a - b);
    const bg = [0, 1, 2].map((c) => quantile(ringList.map((j) => data[j * 4 + c]), 0.5));
    // Excess energy and its centroid (solid-angle weighted).
    const excess = [0, 0, 0];
    let cx = 0;
    let cy = 0;
    let cw = 0;
    for (const i of members) {
      const y = Math.floor(i / width);
      const w = rowWeight(y, height);
      let lum = 0;
      for (let c = 0; c < 3; c += 1) {
        const e = Math.max(0, data[i * 4 + c] - bg[c]) * w;
        excess[c] += e;
        lum += e;
        data[i * 4 + c] = bg[c];
      }
      cx += (i % width) * lum;
      cy += y * lum;
      cw += lum;
    }
    const mx = Math.round(cx / Math.max(1e-9, cw));
    const my = Math.round(cy / Math.max(1e-9, cw));
    const disc = [];
    let omega = 0;
    for (let dy = -SPIKE_RADIUS; dy <= SPIKE_RADIUS; dy += 1) {
      for (let dx = -SPIKE_RADIUS; dx <= SPIKE_RADIUS; dx += 1) {
        if (dx * dx + dy * dy > SPIKE_RADIUS * SPIKE_RADIUS + SPIKE_RADIUS) continue;
        const ny = my + dy;
        if (ny < 0 || ny >= height) continue;
        disc.push(ny * width + ((mx + dx + width) % width));
        omega += rowWeight(ny, height);
      }
    }
    for (const j of disc) for (let c = 0; c < 3; c += 1) data[j * 4 + c] += excess[c] / omega;
  }
  return { width, height, data, spikes: spikes.length };
}

/**
 * Encode an HDR image (Float32 RGBA) into an UltraHDR JPEG. Returns the JPEG
 * bytes and the metadata the decoder reads. Point sources are spread first
 * (`spreadSpikes`).
 */
export async function encodeGainmapJpeg(source, options = GAINMAP_CANDIDATES[GAINMAP_CANDIDATES.length - 1]) {
  const GAIN_DOWNSCALE = options.downscale;
  const hdr = spreadSpikes(source);
  const { width, height, data } = hdr;
  const n = width * height;
  const maxes = new Float32Array(n);
  for (let i = 0; i < n; i += 1) maxes[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const hi = Math.max(1e-4, quantile(maxes, SDR_CLIP_QUANTILE));
  const scale = 1 / hi;
  // SDR base: linear HDR × scale, clipped, sRGB-encoded 8-bit.
  const sdrRaw = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) sdrRaw[i * 3 + c] = Math.round(srgbEncode(data[i * 4 + c] * scale) * 255);
  }
  const jpegOpts = (quality) => ({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' });
  const sdrJpeg = await sharp(sdrRaw, { raw: { width, height, channels: 3 } }).jpeg(jpegOpts(GAINMAP_SDR_QUALITY)).toBuffer();
  // Recovery is computed against the DECODED base, so the gain map also
  // absorbs the base's JPEG error (at the recovery map's resolution).
  const sdrDec = await sharp(sdrJpeg).raw().toBuffer();
  const offsetSdr = GAINMAP_OFFSET_SDR;
  const offsetHdr = GAINMAP_OFFSET_SDR / scale;
  const gw = Math.ceil(width / GAIN_DOWNSCALE);
  const gh = Math.ceil(height / GAIN_DOWNSCALE);
  // Per-texel log2 gain, averaged over each recovery texel's footprint (in log space).
  const logGain = new Float32Array(gw * gh * 3);
  const counts = new Float32Array(gw * gh);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.floor(y / GAIN_DOWNSCALE);
    for (let x = 0; x < width; x += 1) {
      const gi = gy * gw + Math.floor(x / GAIN_DOWNSCALE);
      const i = y * width + x;
      counts[gi] += 1;
      for (let c = 0; c < 3; c += 1) {
        const sdr = srgbDecode(sdrDec[i * 3 + c] / 255);
        logGain[gi * 3 + c] += Math.log2((data[i * 4 + c] + offsetHdr) / (sdr + offsetSdr));
      }
    }
  }
  let minLog = Infinity;
  let maxLog = -Infinity;
  for (let gi = 0; gi < gw * gh; gi += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = logGain[gi * 3 + c] / counts[gi];
      logGain[gi * 3 + c] = v;
      minLog = Math.min(minLog, v);
      maxLog = Math.max(maxLog, v);
    }
  }
  if (maxLog - minLog < 1e-3) maxLog = minLog + 1e-3;
  const gamma = 1;
  const gainRaw = Buffer.alloc(gw * gh * 3);
  for (let k = 0; k < gw * gh * 3; k += 1) {
    const rec = Math.min(1, Math.max(0, (logGain[k] - minLog) / (maxLog - minLog)));
    gainRaw[k] = Math.round(rec ** gamma * 255);
  }
  const gainJpeg = await sharp(gainRaw, { raw: { width: gw, height: gh, channels: 3 } })
    .jpeg({ ...jpegOpts(options.gain), chromaSubsampling: options.chroma })
    .toBuffer();
  const metadata = {
    gainMapMin: [minLog, minLog, minLog],
    gainMapMax: [maxLog, maxLog, maxLog],
    gamma: [gamma, gamma, gamma],
    offsetSdr: [offsetSdr, offsetSdr, offsetSdr],
    offsetHdr: [offsetHdr, offsetHdr, offsetHdr],
    hdrCapacityMin: Math.max(0, minLog),
    hdrCapacityMax: Math.max(1e-3, maxLog),
  };
  const { encodeJPEGMetadata } = await import('@monogrid/gainmap-js/libultrahdr');
  const jpeg = encodeJPEGMetadata({
    ...metadata,
    sdr: { data: new Uint8Array(sdrJpeg), mimeType: 'image/jpeg', width, height },
    gainMap: { data: new Uint8Array(gainJpeg), mimeType: 'image/jpeg', width: gw, height: gh },
  });
  return { jpeg: Buffer.from(jpeg), metadata, scale, spikes: hdr.spikes };
}

/** Split a JPEG-R into its two JPEG streams + XMP metadata (the loader's own path). */
async function splitJpegR(bytes) {
  // The primary image ends at its EOI; the MPF secondary image starts at the next SOI.
  const u8 = new Uint8Array(bytes);
  let secondary = -1;
  for (let i = 4; i < u8.length - 1; i += 1) {
    if (u8[i] === 0xff && u8[i + 1] === 0xd9 && u8[i + 2] === 0xff && u8[i + 3] === 0xd8) {
      secondary = i + 2;
      break;
    }
  }
  if (secondary < 0) throw new Error('JPEG-R: no secondary image');
  const text = Buffer.from(u8.subarray(secondary)).toString('latin1');
  const num = (name) => {
    const m = new RegExp(`hdrgm:${name}="([^"]*)"`).exec(text);
    if (!m) throw new Error(`JPEG-R: no ${name}`);
    return Number.parseFloat(m[1]);
  };
  const metadata = {
    gainMapMin: num('GainMapMin'),
    gainMapMax: num('GainMapMax'),
    gamma: num('Gamma'),
    offsetSdr: num('OffsetSDR'),
    offsetHdr: num('OffsetHDR'),
  };
  return { sdr: Buffer.from(u8.subarray(0, secondary)), gain: Buffer.from(u8.subarray(secondary)), metadata };
}

/** Decode a JPEG-R back to Float32 RGBA exactly as GainMapDecoderMaterial does (weight 1). */
export async function decodeGainmapJpeg(bytes) {
  const { sdr, gain, metadata } = await splitJpegR(bytes);
  const s = await sharp(sdr).raw().toBuffer({ resolveWithObject: true });
  const g = await sharp(gain).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = s.info;
  const gw = g.info.width;
  const gh = g.info.height;
  const gc = g.info.channels;
  const out = new Float32Array(width * height * 4);
  const sampleGain = (u, v, c) => {
    // Bilinear, clamp-to-edge, texel centres (LinearFilter).
    const fx = Math.min(gw - 1, Math.max(0, u * gw - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, v * gh - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x, y) => g.data[(y * gw + x) * gc + (gc >= 3 ? c : 0)] / 255;
    return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      for (let c = 0; c < 3; c += 1) {
        const base = srgbDecode(s.data[i * channels + c] / 255);
        const rec = sampleGain((x + 0.5) / width, (y + 0.5) / height, c) ** (1 / metadata.gamma);
        const logBoost = metadata.gainMapMin * (1 - rec) + metadata.gainMapMax * rec;
        const v = (base + metadata.offsetSdr) * 2 ** logBoost - metadata.offsetHdr;
        out[i * 4 + c] = Math.max(-HALF_MAX, Math.min(HALF_MAX, v));
      }
      out[i * 4 + 3] = 1;
    }
  }
  return { width, height, data: out };
}

// ── Probe sphere ΔE ─────────────────────────────────────────────────────────

function dirOf(u, v) {
  // three's equirect convention (v = 1 at the zenith); only relative use matters here.
  const phi = (u - 0.5) * 2 * Math.PI;
  const theta = (v - 0.5) * Math.PI;
  return [Math.cos(theta) * Math.sin(phi), Math.sin(theta), -Math.cos(theta) * Math.cos(phi)];
}

/** Area-average an equirect image down to w × h (Float64 RGB) with per-texel solid angles. */
function downsampleEquirect(img, w, h) {
  const fx = img.width / w;
  const fy = img.height / h;
  const rgb = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < fy; sy += 1) {
        for (let sx = 0; sx < fx; sx += 1) {
          const i = ((y * fy + sy) * img.width + x * fx + sx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
        }
      }
      const k = (y * w + x) * 3;
      rgb[k] = r / (fx * fy);
      rgb[k + 1] = g / (fx * fy);
      rgb[k + 2] = b / (fx * fy);
    }
  }
  const texels = [];
  for (let y = 0; y < h; y += 1) {
    const v = 1 - (y + 0.5) / h;
    const theta = (v - 0.5) * Math.PI;
    const omega = ((2 * Math.PI) / w) * (Math.PI / h) * Math.cos(theta);
    for (let x = 0; x < w; x += 1) texels.push({ d: dirOf((x + 0.5) / w, v), omega, k: (y * w + x) * 3 });
  }
  return { rgb, texels };
}

/** Probe responses: diffuse (cosine) and glossy (cos^32) for a set of normals. */
function probeResponses(img, normals) {
  const { rgb, texels } = downsampleEquirect(img, 256, 128);
  return normals.map((n) => {
    const diff = [0, 0, 0];
    const gloss = [0, 0, 0];
    let gw = 0;
    for (const t of texels) {
      const c = n[0] * t.d[0] + n[1] * t.d[1] + n[2] * t.d[2];
      if (c <= 0) continue;
      const wd = (c * t.omega) / Math.PI;
      const wg = c ** 32 * t.omega;
      gw += wg;
      for (let ch = 0; ch < 3; ch += 1) {
        diff[ch] += rgb[t.k + ch] * wd;
        gloss[ch] += rgb[t.k + ch] * wg;
      }
    }
    return { diff, gloss: gloss.map((v) => v / gw) };
  });
}

function toLab(rgbLinear, exposure) {
  // Simple filmic display (x / (1 + x)) after exposure, sRGB → XYZ (D65) → Lab.
  const disp = rgbLinear.map((v) => {
    const x = Math.max(0, v * exposure);
    return srgbDecode(srgbEncode(x / (1 + x)));
  });
  const [r, g, b] = disp;
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function deltaE76(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Max / mean ΔE76 of a probe sphere (diffuse + glossy) between two env images. */
export function probeDeltaE(reference, candidate) {
  const normals = [];
  // Fibonacci sphere: every direction a probe sphere shows from any view.
  const count = 400;
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    normals.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  const ref = probeResponses(reference, normals);
  const cand = probeResponses(candidate, normals);
  const meanLum = ref.reduce((s, r) => s + 0.2126 * r.diff[0] + 0.7152 * r.diff[1] + 0.0722 * r.diff[2], 0) / ref.length;
  const exposure = 0.5 / Math.max(1e-6, meanLum);
  const stats = { diffuse: { max: 0, mean: 0 }, glossy: { max: 0, mean: 0 } };
  for (let i = 0; i < normals.length; i += 1) {
    for (const key of ['diffuse', 'glossy']) {
      const field = key === 'diffuse' ? 'diff' : 'gloss';
      const e = deltaE76(toLab(ref[i][field], exposure), toLab(cand[i][field], exposure));
      stats[key].max = Math.max(stats[key].max, e);
      stats[key].mean += e / normals.length;
    }
  }
  return stats;
}

/**
 * Light-source centroid (the sun / moon azimuth): the energy-weighted centre
 * of every texel above half the peak luminance. The hdriYaw anchor must not move.
 */
export function brightestTexel(img) {
  const lum = (i) => 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
  let peak = 0;
  for (let i = 0; i < img.width * img.height; i += 1) peak = Math.max(peak, lum(i));
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = 0; i < img.width * img.height; i += 1) {
    const l = lum(i);
    if (l < peak * 0.5) continue;
    sx += (i % img.width) * l;
    sy += Math.floor(i / img.width) * l;
    sw += l;
  }
  return { x: sx / sw, y: sy / sw, lum: peak };
}

async function encodeGainmaps() {
  let failed = false;
  for (const role of Object.keys(HDRIS)) {
    const hdrFile = join(ENV_DIR, 'hdri', `${role}.hdr`);
    const jpgFile = join(ENV_DIR, 'hdri', `${role}.jpg`);
    if (!existsSync(hdrFile)) throw new Error(`missing ${hdrFile} — run without --gainmap first`);
    const hdr = await readHdr(hdrFile);
    if (!probeOnly && (force || !existsSync(jpgFile))) {
      let chosen = null;
      for (const options of GAINMAP_CANDIDATES) {
        const { jpeg, spikes } = await encodeGainmapJpeg(hdr, options);
        const s = probeDeltaE(hdr, await decodeGainmapJpeg(jpeg));
        const worst = Math.max(s.diffuse.max, s.glossy.max);
        log(`  ${role}: recovery 1/${options.downscale} q${options.gain} ${options.chroma} → ${Math.round(jpeg.length / 1024)} KB, ΔE max ${worst.toFixed(2)} (${spikes} spike${spikes === 1 ? '' : 's'} spread)`);
        chosen = jpeg;
        if (worst < GAINMAP_TARGET_DE) break;
      }
      writeFileSync(jpgFile, chosen);
    }
    const decoded = await decodeGainmapJpeg(readFileSync(jpgFile));
    const stats = probeDeltaE(hdr, decoded);
    const a = brightestTexel(hdr);
    const b = brightestTexel(decoded);
    const worst = Math.max(stats.diffuse.max, stats.glossy.max);
    log(
      `hdri ${role}.jpg ${kb(jpgFile)} KB (hdr ${kb(hdrFile)} KB) — probe ΔE76 diffuse max ${stats.diffuse.max.toFixed(2)} / mean ${stats.diffuse.mean.toFixed(2)}, glossy max ${stats.glossy.max.toFixed(2)} / mean ${stats.glossy.mean.toFixed(2)}; light centroid ${a.x.toFixed(1)},${a.y.toFixed(1)} → ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
    );
    if (worst >= 3) {
      log(`  FAIL: ${role} probe ΔE ${worst.toFixed(2)} ≥ 3`);
      failed = true;
    }
    if (Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2) {
      log(`  FAIL: ${role} brightest texel moved (hdriYaw anchor)`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

// ── Attribution ─────────────────────────────────────────────────────────────

/** ROLLOUT §5 derived sets (`paint-bake.mjs --world <w>`): [role, source id, what]. */
export const ROLLOUT_DERIVED = [
  ['sakura-lawn', 'aerial_grass_rock', 'Diffuse + nor_gl, cavity from the 1k Displacement (cache only); spring-green ramp'],
  ['sakura-gravel', 'gravel_floor_02', 'Diffuse + nor_gl, cavity from the 1k Displacement (cache only); raked-granite ramp'],
  ['stone-grain', 'rock_wall_08', 'Diffuse + nor_gl, grain only (macro blotch removed); shared by the painted-stone kit'],
  ['sakura-planks', 'weathered_brown_planks', 'Diffuse + nor_gl at 512; weathered-timber ramp'],
  ['mountain-meadow', 'forrest_ground_01', 'Diffuse + nor_gl, cavity from the 1k Displacement (cache only); alpine-meadow ramp'],
  ['mountain-granite', 'rock_face', 'Diffuse + nor_gl, cavity from the 1k Displacement (cache only); cool granite ramp'],
  ['mountain-snow', 'snow_02', 'nor_gl only, at 512 (the snow albedo is procedural)'],
  ['clouds-cap', 'aerial_grass_rock', 'Diffuse + nor_gl, cavity from the 1k Displacement (cache only); sea-green ramp'],
  ['clouds-strata', 'plaster_grey_04', 'Diffuse + nor_gl, grain only; cream-limestone ramp (the strata are procedural in-material)'],
];

/** ROLLOUT §5 authored files (no third-party source): [env-relative path, what]. */
export const ROLLOUT_AUTHORED = [
  ['sakura/skyline.webp', 'sakura hill-and-pagoda skyline atlas (R/G/B near/mid/far coverage, A 0), baked by `bake-sakura-skyline.mjs`'],
  ['sakura/mask.webp', 'sakura ground story mask (path wear, moss and tree AO, petal drift, macro noise), baked by `bake-sakura-mask.mts`'],
  ['sakura/grass-card.webp', 'sakura painted grass-clump card (RGBA), baked by `bake-grass-card.mjs`'],
  ['mountain/skyline.webp', 'mountain ridge atlas (R/G/B near/mid/far coverage, A 0), baked by `bake-mountain-ridges.mjs`'],
  ['mountain/mask.webp', 'mountain ground story mask (trail wear, scree and contact, lee snow and wet tarn band, macro noise), baked by `bake-mountain-mask.mts`'],
  ['clouds/skyline.webp', 'clouds far ring of cumulus towers and distant isles (R/G/B near/mid/far coverage, A 0), baked by `bake-clouds-farring.mjs`'],
  ['clouds/mask.webp', 'clouds isle-cap story mask (worn paths, contact, flower specks, macro noise), baked by `bake-clouds-mask.mts`'],
];

/** A derived set ships when its diff (or, for normal-only sets, its nor) is on disk. */
function shipsSet(has, role) {
  return has(`tex/${role}/diff.webp`) || has(`tex/${role}/diff.ktx2`) || has(`tex/${role}/nor.webp`);
}

/**
 * ATTRIBUTION.md from what is actually on disk under `envDir`: the Poly Haven
 * originals, the gain-map re-encodes and the painterly derived sets.
 */
export function attributionLines(envDir) {
  const has = (rel) => existsSync(join(envDir, rel));
  const ph = (id) => `[${id}](https://polyhaven.com/a/${id})`;
  const lines = ['# Environment asset attribution', '', 'All third-party assets are CC0 1.0 from [Poly Haven](https://polyhaven.com).', ''];
  lines.push('## Originals (re-encoded)', '');
  for (const [role, id] of Object.entries(HDRIS)) {
    lines.push(`- \`env/hdri/${role}.hdr\` — ${ph(id)} ${RES} HDR`);
    if (has(`hdri/${role}.jpg`)) {
      lines.push(
        `- \`env/hdri/${role}.jpg\` — ${ph(id)} ${RES} HDR re-encoded as an UltraHDR gain-map JPEG (\`env-assets.mjs --gainmap\`; point sources such as the moon re-painted as energy-equal 3-texel discs)`,
      );
    }
  }
  for (const [role, id] of Object.entries(TEXTURES)) {
    lines.push(`- \`env/tex/${role}/\` — ${ph(id)} ${RES} Diffuse / nor_gl / arm`);
  }
  // Rollout originals: cache-only sources, listed once a set derived from them ships.
  const shippedIds = new Set(ROLLOUT_DERIVED.filter(([role]) => shipsSet(has, role)).map(([, id]) => id));
  for (const src of ROLLOUT_SOURCES) {
    if (!shippedIds.has(src.id)) continue;
    const maps = src.maps.map((m) => ROLLOUT_MAP_KEYS[m]).join(' / ');
    lines.push(`- ${ph(src.id)} ${RES} ${maps} — original kept in the bake cache only (never shipped raw); source of ${src.use}`);
  }
  const derived = [
    ['plaza-ground', 'cobblestone_floor_08', 'Diffuse + nor_gl, with the 1k Displacement (cache only, never shipped) as the cavity / edge source'],
    ['plaza-ashlar', 'plaster_grey_04', 'Diffuse + nor_gl + arm (grain only; coursing is procedural in-material)'],
    ['plaza-slate', 'roof_slates_03', 'Diffuse + nor_gl + arm'],
    ...ROLLOUT_DERIVED,
  ].filter(([role]) => shipsSet(has, role));
  if (derived.length > 0) {
    lines.push('', '## Derived works (painterly bake, `paint-bake.mjs`)', '');
    lines.push(
      'Painted re-interpretations of the CC0 originals (Kuwahara filter, value ramp, quantised bands, cavity and edge light). CC0 needs no attribution; it is kept for provenance.',
      '',
    );
    for (const [role, id, what] of derived) lines.push(`- \`env/tex/${role}/\` — derived from ${ph(id)} ${RES} ${what}`);
  }
  const authored = [
    ['plaza/mask.webp', 'plaza ground story mask (wear lanes, contact grime, puddles, macro noise), baked by `bake-plaza-mask.mts`'],
    ['plaza/skyline.webp', 'Lumiose skyline silhouette atlas from authored polylines, baked by `bake-plaza-skyline.mjs`'],
    ...ROLLOUT_AUTHORED,
  ].filter(([rel]) => has(rel));
  if (authored.length > 0) {
    lines.push('', '## Authored in this repository (no third-party source)', '');
    for (const [rel, what] of authored) lines.push(`- \`env/${rel}\` — ${what}`);
  }
  return lines;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (rolloutOnly) {
    await downloadRolloutSources();
    return;
  }
  if (attributionOnly) {
    writeFileSync(join(ENV_DIR, 'ATTRIBUTION.md'), `${attributionLines(ENV_DIR).join('\n')}\n`);
    log(`ATTRIBUTION.md rewritten in ${ENV_DIR}`);
    return;
  }
  ensureDir(PH_CACHE);
  ensureDir(join(ENV_DIR, 'hdri'));
  ensureDir(join(ENV_DIR, 'tex'));
  if (gainmap) {
    await encodeGainmaps();
    writeFileSync(join(ENV_DIR, 'ATTRIBUTION.md'), `${attributionLines(ENV_DIR).join('\n')}\n`);
    return;
  }
  const toktx = findToktx();
  if (!toktx) log('toktx not found — texture maps will be written as WebP (see README.md).');

  for (const [role, id] of Object.entries(HDRIS)) {
    const files = await fetchJson(`${API}/files/${id}`);
    const url = files.hdri?.[RES]?.hdr?.url;
    if (!url) throw new Error(`no ${RES} hdr for ${id}`);
    const cached = join(PH_CACHE, `${id}_${RES}.hdr`);
    const fresh = await download(url, cached);
    const out = join(ENV_DIR, 'hdri', `${role}.hdr`);
    if (!existsSync(out) || force) copyFileSync(cached, out);
    log(`hdri ${role} ← ${id} (${kb(out)} KB${fresh ? '' : ', cached'})`);
  }

  for (const [role, id] of Object.entries(TEXTURES)) {
    const files = await fetchJson(`${API}/files/${id}`);
    const dir = join(ENV_DIR, 'tex', role);
    ensureDir(dir);
    await parallel(TEXTURE_MAPS, 3, async (map) => {
      const entry = files[map.key]?.[RES];
      const url = entry?.jpg?.url ?? entry?.png?.url;
      if (!url) {
        log(`  ${id}: no ${map.key} at ${RES}`);
        return;
      }
      const ext = entry?.jpg?.url ? 'jpg' : 'png';
      const cached = cachedMapPath(id, map.out, ext);
      await download(url, cached);
      if (toktx) {
        const out = join(dir, `${map.out}.ktx2`);
        if (!existsSync(out) || force) encodeKtx2(toktx, cached, out, map);
        log(`  tex ${role}/${map.out}.ktx2 ${kb(out)} KB`);
      } else {
        const out = join(dir, `${map.out}.webp`);
        if (!existsSync(out) || force) {
          await sharp(cached).webp({ quality: map.srgb ? 82 : 92, effort: 5 }).toFile(out);
        }
        log(`  tex ${role}/${map.out}.webp ${kb(out)} KB`);
      }
    });
  }

  for (const src of CACHE_ONLY) {
    const files = await fetchJson(`${API}/files/${src.id}`);
    const url = files[src.key]?.[RES]?.[src.format]?.url;
    if (!url) throw new Error(`no ${RES} ${src.key} ${src.format} for ${src.id}`);
    const cached = cachedMapPath(src.id, src.out, src.format);
    const fresh = await download(url, cached);
    log(`  cache-only ${src.id} ${src.key} → ${cached} (${kb(cached)} KB${fresh ? '' : ', cached'}; never shipped)`);
  }

  writeFileSync(join(ENV_DIR, 'ATTRIBUTION.md'), `${attributionLines(ENV_DIR).join('\n')}\n`);
  log(
    toMirror
      ? 'env assets ready in the mirror → run paint-bake.mjs, then bake-manifest.mjs --refresh-mirror'
      : 'env assets ready → run bake-manifest.mjs --mirror, then upload-supabase.mjs',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
