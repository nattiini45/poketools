/**
 * Shared helpers for the EvoLiga route-world asset pipeline.
 *
 * download → transform → bake-manifest → upload (see README.md in this folder).
 * Everything here runs in Node only; nothing is imported by the app.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');
export const CACHE_DIR = join(__dirname, '.cache');
export const RAW_DIR = join(CACHE_DIR, 'raw');
export const OUT_DIR = join(__dirname, 'out');
export const OUT_MODELS_DIR = join(OUT_DIR, 'models');
export const OUT_ENV_DIR = join(OUT_DIR, 'env');
export const MIRROR_DIR = join(ROOT, 'public', 'models', 'world');
export const HEIGHTS_CACHE = join(CACHE_DIR, 'heights.json');
export const MISSING_FILE = join(CACHE_DIR, 'missing.json');

export const SOURCE_BASE = 'https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt';
export const BUCKET = 'world-assets';

/**
 * The roster roots the figure set starts from: base-stage species of the drafted lines.
 * Evolutions are derived from @pkmn/dex.
 *
 * A league's pool is kept out of the tree (format packs, docs/format-packs.md): it lives in the
 * private pack as `world-roster.json` (`baseDexIds`, plus `baseSpeciesExtra` for regional
 * starting points that are their own line). A checkout without the private pack uses the
 * base species of the example pack's synthetic list instead.
 */
export const PRIVATE_ROSTER_FILE = join(ROOT, 'src', 'format-packs', 'private', 'world-roster.json');
export const EXAMPLE_LINES_FILE = join(ROOT, 'src', 'app', '(public)', 'draft-preview', 'fixture-lines.example.json');

/**
 * `{ baseDexIds, baseSpeciesExtra }` from the private pack, or null when the file is absent (no
 * private pack). A file that exists but yields no usable roots is an error, never an empty
 * roster: the pipeline would otherwise download and bake nothing and still exit 0.
 */
export function readPrivateRoster(file = PRIVATE_ROSTER_FILE) {
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const field of ['baseDexIds', 'baseSpeciesExtra']) {
    if (raw && raw[field] !== undefined && !Array.isArray(raw[field])) {
      throw new Error(`${file}: "${field}" must be an array (got ${raw[field] === null ? 'null' : typeof raw[field]})`);
    }
  }
  const ids = raw && Array.isArray(raw.baseDexIds) ? raw.baseDexIds : [];
  const extras = raw && Array.isArray(raw.baseSpeciesExtra) ? raw.baseSpeciesExtra : [];
  const baseDexIds = ids.filter((n) => Number.isInteger(n) && n > 0);
  const baseSpeciesExtra = extras.filter((s) => typeof s === 'string' && s.trim().length > 0);
  const dropped = ids.length - baseDexIds.length + (extras.length - baseSpeciesExtra.length);
  if (dropped > 0) console.warn(`[world-assets] ${file}: ignored ${dropped} malformed roster entr${dropped === 1 ? 'y' : 'ies'}`);
  if (baseDexIds.length + baseSpeciesExtra.length === 0) {
    throw new Error(
      `${file} exists but lists no roster roots: expected { "baseDexIds": [<dex number>, ...], "baseSpeciesExtra": [<species>, ...] } with at least one entry`,
    );
  }
  return { baseDexIds, baseSpeciesExtra };
}

/**
 * Root species names of the roster lines (private pack first, else the example list's bases).
 * Dex numbers or names @pkmn/dex does not know are reported and skipped; a roster in which none
 * resolve is an error.
 */
export function rosterRootSpecies(file = PRIVATE_ROSTER_FILE) {
  const roster = readPrivateRoster(file);
  if (roster) {
    const byNum = regularSpeciesByNum();
    const unknownNums = roster.baseDexIds.filter((num) => !byNum.has(num));
    const unknownNames = roster.baseSpeciesExtra.filter((name) => !Dex.species.get(name)?.exists);
    if (unknownNums.length + unknownNames.length > 0) {
      console.warn(
        `[world-assets] ${file}: skipped roster roots @pkmn/dex does not know: ${[...unknownNums, ...unknownNames].join(', ')}`,
      );
    }
    const roots = [
      ...roster.baseDexIds.map((num) => byNum.get(num)?.name).filter(Boolean),
      ...roster.baseSpeciesExtra.filter((name) => Dex.species.get(name)?.exists),
    ];
    if (roots.length === 0) throw new Error(`${file}: none of its roster roots resolve to a species`);
    return roots;
  }
  const lines = JSON.parse(readFileSync(EXAMPLE_LINES_FILE, 'utf8'));
  return [...new Set(lines.map((line) => line.base_pokemon).filter(Boolean))];
}

/** Poké Center staff — not on any roster, always present at the desk. */
export const NURSE_SPECIES = ['Chansey', 'Blissey', 'Audino'];

/** @pkmn forme → Pokemon-3D-api category folder. */
const REGIONAL_CATEGORY = {
  Alola: 'alolan',
  Galar: 'galarian',
  Hisui: 'hisuian',
  Paldea: 'paldean',
};

/** @pkmn forme → PokéAPI slug suffix. */
const REGIONAL_POKEAPI = {
  Alola: 'alola',
  Galar: 'galar',
  Hisui: 'hisui',
  Paldea: 'paldea',
};

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Parse `.env.local` (and `.env`) without adding a dependency. */
export function loadEnvLocal() {
  for (const name of ['.env', '.env.local']) {
    const file = join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export function walkFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, ext));
    else if (!ext || name.endsWith(ext)) out.push(full);
  }
  return out;
}

export function relPosix(from, file) {
  return relative(from, file).split('\\').join('/');
}

/** Normalize for lookup — accents, hyphens, spacing vary by source. */
export function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function regularSpeciesByNum() {
  const byNum = new Map();
  for (const species of Dex.species.all()) {
    if (species.num <= 0 || species.forme) continue;
    if (!byNum.has(species.num)) byNum.set(species.num, species);
  }
  return byNum;
}

/**
 * One figure the pipeline should produce: a (dexId, category) pair with the
 * @pkmn species it represents. Non-regional formes collapse onto the regular
 * file for their dexId; the manifest lists them as aliases.
 */
export function describeSpecies(species) {
  const forme = species.forme || '';
  const category = REGIONAL_CATEGORY[forme] ?? 'regular';
  const pokeapi =
    category === 'regular'
      ? String(species.num)
      : `${normalizeName(species.baseSpecies)}-${REGIONAL_POKEAPI[forme]}`;
  return {
    dexId: species.num,
    category,
    species: category === 'regular' ? species.baseSpecies : species.name,
    pokeapi,
    aliases: forme && category === 'regular' ? [species.name] : [],
  };
}

/**
 * Every species the plaza can show: all base lines, every evolution reachable
 * from them (all branches), the nurse species, plus `extra` names.
 * Returns a Map keyed by `${category}/${dexId}`.
 */
export function buildFigureSet(extra = []) {
  const roots = [
    ...rosterRootSpecies(),
    ...NURSE_SPECIES,
    ...extra,
  ];
  const figures = new Map();
  const visited = new Set();

  const walk = (name) => {
    const species = Dex.species.get(name);
    if (!species || !species.exists || visited.has(species.name)) return;
    visited.add(species.name);
    const desc = describeSpecies(species);
    const key = `${desc.category}/${desc.dexId}`;
    const existing = figures.get(key);
    if (existing) {
      for (const alias of desc.aliases) if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
    } else {
      figures.set(key, desc);
    }
    for (const evo of species.evos ?? []) walk(evo);
  };

  for (const root of roots) walk(root);
  return figures;
}

export function figureKey(category, dexId) {
  return `${category}/${dexId}`;
}

export function log(...args) {
  console.log(...args);
}

/** Run `n` async jobs at a time. */
export async function parallel(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Locate the KTX-Software `toktx` binary (PATH, KTX_BIN, or the user-local install). */
export function findToktx() {
  if (process.env.KTX_BIN && existsSync(process.env.KTX_BIN)) return process.env.KTX_BIN;
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'KTX-Software', 'bin', 'toktx.exe'),
    'C:\\Program Files\\KTX-Software\\bin\\toktx.exe',
    '/usr/local/bin/toktx',
    '/opt/homebrew/bin/toktx',
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  for (const dir of pathDirs) {
    for (const bin of ['toktx.exe', 'toktx']) {
      const full = join(dir, bin);
      if (dir && existsSync(full)) return full;
    }
  }
  return null;
}

// ── Rollout bake helpers (ROLLOUT-PLAN §3.3): atlases and story masks ────────
//
// Pure, deterministic maths shared by the per-world bake scripts
// (`bake-sakura-skyline.mjs`, `bake-mountain-ridges.mjs`,
// `bake-clouds-farring.mjs`, `bake-<world>-mask.mts`, `bake-grass-card.mjs`).
// No Math.random, no clocks: integer hashes only. Frozen after B4; a change
// here goes through the shared-file protocol.

/** 32-bit integer hash → [0, 1) (the same mixer as plaza-ground `hash2`). */
export function hash3(a, b, seed = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth01(t) {
  return t * t * (3 - 2 * t);
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export function smoothstep(a, b, x) {
  return smooth01(clamp01((x - a) / (b - a)));
}

/** Smooth 1D value noise, PERIODIC over u in [0, 1) with `cells` lattice cells (seamless around the ring). */
export function ringNoise(u, cells, seed = 0) {
  const s = (((u % 1) + 1) % 1) * cells;
  const i = Math.floor(s);
  const f = smooth01(s - i);
  const a = hash3(i % cells, 0, seed);
  const b = hash3((i + 1) % cells, 0, seed);
  return a + (b - a) * f;
}

/** Periodic 1D fBm (the cell count doubles per octave, so every octave wraps). */
export function ringFbm(u, cells, octaves, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * ringNoise(u, cells * 2 ** o, seed + o * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Shortest signed azimuth difference a − b in turns, in [−0.5, 0.5). */
export function ringDelta(a, b) {
  return ((((a - b) % 1) + 1.5) % 1) - 0.5;
}

/** Smooth 2D value noise over world metres (`cell` metres per lattice cell). */
export function worldNoise(x, z, cell, seed = 0) {
  const sx = x / cell;
  const sz = z / cell;
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const fx = smooth01(sx - ix);
  const fz = smooth01(sz - iz);
  const a = hash3(ix, iz, seed);
  const b = hash3(ix + 1, iz, seed);
  const c = hash3(ix, iz + 1, seed);
  const d = hash3(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

/** 2D fBm over world metres; the cell halves per octave. */
export function worldFbm(x, z, cell, octaves, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let c = cell;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * worldNoise(x, z, c, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    c /= 2;
  }
  return sum / norm;
}

/** Distance from (x, z) to the segment a → b. */
export function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

/**
 * Rasterise a skyline atlas. `bands[k] = { channel, spans(u) }`, where
 * `spans(u)` returns the covered vertical intervals [[v0, v1], ...] of the
 * band at azimuth u (v 0 = ground, v 1 = band top). Coverage is exact-area
 * anti-aliased in v and supersampled `samples`× in u; A stays 0 (no windows).
 * Returns { width, height, data } (RGBA, row 0 = v 1, three's flipY).
 */
export function rasterSkylineAtlas({ width, height, bands, samples = 4 }) {
  const data = new Uint8Array(width * height * 4);
  const acc = new Float32Array(height);
  for (const band of bands) {
    for (let x = 0; x < width; x += 1) {
      acc.fill(0);
      for (let s = 0; s < samples; s += 1) {
        const u = (x + (s + 0.5) / samples) / width;
        for (const [v0, v1] of band.spans(u)) {
          const lo = Math.max(0, v0) * height;
          const hi = Math.min(1, v1) * height;
          if (hi <= lo) continue;
          // Texel k (from the bottom) covers [k, k + 1) in v·height.
          for (let k = Math.floor(lo); k < Math.min(height, Math.ceil(hi)); k += 1) {
            const overlap = Math.min(hi, k + 1) - Math.max(lo, k);
            if (overlap > 0) acc[height - 1 - k] += overlap / samples;
          }
        }
      }
      for (let row = 0; row < height; row += 1) data[(row * width + x) * 4 + band.channel] = Math.round(clamp01(acc[row]) * 255);
    }
  }
  return { width, height, data };
}

/** Chebyshev dilation of a binary raster by `radius` texels. */
export function dilateBinary(src, size, radius) {
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

/** Mask texel (col, row; row 0 = north edge) → world (x, z) of its centre, for a `WorldMaskLayout`. */
export function maskTexelWorld(layout, col, row) {
  const m = layout.extentM / layout.size;
  return [layout.centre[0] - layout.extentM / 2 + (col + 0.5) * m, layout.centre[1] - layout.extentM / 2 + (row + 0.5) * m];
}

/**
 * The generic dry-band solver of a world: the plaza's `createDryBand`
 * without the plaza's board-wall boxes. A ground point (x, groundY(x, z), z)
 * is DRY when it falls inside any face's footer band seen from any reading
 * pose (`zones` = plaza-ground `dryScreenZones(theme)`), and in a WEDGE when
 * it is inside any keep-out wedge (`wedges` = `themeWedges(theme)`).
 * `cameraBasis` and `wedgeHitsSphere` are injected from data-surfaces.ts.
 */
export function createWorldDryBand({ zones, wedges, cameraBasis, wedgeHitsSphere, groundY, rigNear = 0.5 }) {
  const compiled = zones.map((zone) => {
    const { right, up, forward } = cameraBasis(zone.pose.camera);
    const tanHalf = Math.tan((zone.pose.camera.fov * Math.PI) / 360);
    const { width, height } = zone.pose.viewport;
    return { rect: zone.rect, eye: zone.pose.camera.position, right, up, forward, sx: tanHalf * (width / height), sy: tanHalf, width, height };
  });
  return {
    zones: zones.length,
    wedges: wedges.length,
    isDry(x, z) {
      const y = groundY(x, z);
      for (const c of compiled) {
        const rx = x - c.eye[0];
        const ry = y - c.eye[1];
        const rz = z - c.eye[2];
        const depth = rx * c.forward[0] + ry * c.forward[1] + rz * c.forward[2];
        if (depth < rigNear) continue;
        const nx = (rx * c.right[0] + ry * c.right[1] + rz * c.right[2]) / (depth * c.sx);
        const ny = (rx * c.up[0] + ry * c.up[1] + rz * c.up[2]) / (depth * c.sy);
        const px = ((nx + 1) / 2) * c.width;
        const py = ((1 - ny) / 2) * c.height;
        if (px >= c.rect.x0 && px <= c.rect.x1 && py >= c.rect.y0 && py <= c.rect.y1) return true;
      }
      return false;
    },
    inWedge(x, z) {
      const p = [x, groundY(x, z), z];
      for (const wedge of wedges) if (wedgeHitsSphere(wedge, p, 0)) return true;
      return false;
    },
  };
}

/**
 * Rasterise a world story mask (`WorldMaskLayout`). `fields(x, z)` returns
 * [r, g, b, a] in 0..1. B is FORCED to 0 on every texel of the dry band ∪
 * wedges (2×2 supersampled dry test, texel-centre wedge test), dilated by
 * 1 + ceil(dryMarginM / texel). The outermost texel ring is 0 in every
 * channel (clamp-to-edge reads 0 off the square). A is quantised to 64 levels.
 */
export function rasterWorldMask({ layout, fields, dry, aLevels = 63 }) {
  const { size } = layout;
  const texelM = layout.extentM / size;
  const q = texelM / 4;
  const raw = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const [x, z] = maskTexelWorld(layout, col, row);
      const isDry = dry.isDry(x - q, z - q) || dry.isDry(x + q, z - q) || dry.isDry(x - q, z + q) || dry.isDry(x + q, z + q);
      raw[row * size + col] = isDry || dry.inWedge(x, z) ? 1 : 0;
    }
  }
  const forbidden = dilateBinary(raw, size, 1 + Math.ceil(layout.dryMarginM / texelM));
  const data = new Uint8Array(size * size * 4);
  const byte = (v) => Math.round(clamp01(v) * 255);
  for (let row = 1; row < size - 1; row += 1) {
    for (let col = 1; col < size - 1; col += 1) {
      const [x, z] = maskTexelWorld(layout, col, row);
      const [r, g, b, a] = fields(x, z);
      const i = (row * size + col) * 4;
      data[i] = byte(r);
      data[i + 1] = byte(g);
      data[i + 2] = forbidden[row * size + col] ? 0 : byte(b);
      data[i + 3] = Math.round(Math.round(clamp01(a) * aLevels) * (255 / aLevels));
    }
  }
  return { size, data, forbidden };
}

/** Lossless RGBA WebP (`exact` keeps RGB under A = 0, so keep-out zeros survive bit-exactly). */
export async function encodeLosslessRgba(raster) {
  const { default: sharp } = await import('sharp');
  const width = raster.width ?? raster.size;
  const height = raster.height ?? raster.size;
  return sharp(Buffer.from(raster.data), { raw: { width, height, channels: 4 } })
    .webp({ lossless: true, exact: true, effort: 6 })
    .toBuffer();
}

/** Decode a WebP (or any sharp input) back to raw RGBA. */
export async function decodeRgba(bytes) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
