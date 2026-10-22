#!/usr/bin/env node
/**
 * generate-placeholder-avatars.mjs
 *
 * The trainer sprite layers under `public/avatar/` are third-party art and are not
 * distributed with this repository (see NOTICE.md). This script fills the gap with
 * simple generated placeholder layers so a fresh checkout has a working avatar builder.
 *
 * It reads `src/lib/avatar/manifest-data.json` (gender -> category -> style -> variants)
 * and writes one 160x160 RGBA PNG per variant at
 * `public/avatar/{gender}/{category}/{filename}` — the same paths the app requests
 * (`getAvatarAssetUrl`). Each layer is a flat silhouette for its category (skin base,
 * legs, torso, hair, hat) in the variant's colour, so the paper-doll compositing still
 * reads.
 *
 * It NEVER overwrites an existing file: real layers (local copies, or the files that
 * `scripts/fetch-private-assets.mjs` fetched) always win, and a second run is a no-op.
 * Pure Node (zlib only), no dependencies. Run by `predev` and `prebuild`.
 *
 * Usage: node scripts/generate-placeholder-avatars.mjs [--quiet]
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SIZE = 160;

// ─── PNG encoding ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA pixel buffer (width*height*4) as a PNG. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drawing ─────────────────────────────────────────────────────

const NAMED = {
  light: '#f6d7b8', pale: '#fde7d6', medium: '#d9a066', dark: '#8d5524',
  black: '#2b2b33', white: '#f2f2f2', grey: '#8a8f98', silver: '#c0c4cc',
  blue: '#3b6fd8', navy: '#24366b', aqua: '#3cc6c9', cyan: '#2fb3e0',
  green: '#3e9b4f', pink: '#ef8fb7', red: '#d23c3c', wine: '#7b2338',
  beige: '#d8c39a', brown: '#6b3f26', brownish: '#8a5a3a', yellow: '#f0cf3a',
  gold: '#d4a62a', orange: '#ec8a2e', purple: '#7e4cc2', violet: '#9b6ce0',
  magenta: '#c43ca8', blonde: '#e8c766', blond: '#e8c766', ginger: '#c8642c',
  bee: '#e9b81f', default: '#7a8aa0',
};

/** Hex colour for a variant colour name; unknown names get a stable hashed hue. */
export function colourFor(name) {
  const hex = NAMED[name];
  if (hex) return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (0.55 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Category silhouettes on a 160x160 canvas: a list of shapes. */
const SHAPES = {
  base: [
    { kind: 'ellipse', cx: 80, cy: 46, rx: 22, ry: 25 }, // head
    { kind: 'rect', x: 72, y: 66, w: 16, h: 10 }, // neck
    { kind: 'rect', x: 56, y: 74, w: 48, h: 44 }, // torso
    { kind: 'rect', x: 44, y: 76, w: 12, h: 40 }, // arms
    { kind: 'rect', x: 104, y: 76, w: 12, h: 40 },
    { kind: 'rect', x: 60, y: 116, w: 16, h: 38 }, // legs
    { kind: 'rect', x: 84, y: 116, w: 16, h: 38 },
  ],
  bottoms: [
    { kind: 'rect', x: 56, y: 108, w: 48, h: 14 },
    { kind: 'rect', x: 58, y: 120, w: 20, h: 32 },
    { kind: 'rect', x: 82, y: 120, w: 20, h: 32 },
  ],
  tops: [
    { kind: 'rect', x: 54, y: 72, w: 52, h: 40 },
    { kind: 'rect', x: 42, y: 74, w: 14, h: 22 },
    { kind: 'rect', x: 104, y: 74, w: 14, h: 22 },
  ],
  hair: [
    { kind: 'ellipse', cx: 80, cy: 36, rx: 25, ry: 17 },
    { kind: 'rect', x: 55, y: 36, w: 8, h: 26 },
    { kind: 'rect', x: 97, y: 36, w: 8, h: 26 },
  ],
  hats: [
    { kind: 'rect', x: 58, y: 16, w: 44, h: 16 },
    { kind: 'rect', x: 50, y: 30, w: 66, h: 6 },
  ],
};

function inside(shape, x, y) {
  if (shape.kind === 'rect') return x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h;
  const dx = (x + 0.5 - shape.cx) / shape.rx;
  const dy = (y + 0.5 - shape.cy) / shape.ry;
  return dx * dx + dy * dy <= 1;
}

/** Render one placeholder layer as a PNG buffer. */
export function renderPlaceholder(category, colourName) {
  const shapes = SHAPES[category] ?? SHAPES.tops;
  const [r, g, b] = colourFor(colourName);
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!shapes.some((s) => inside(s, x, y))) continue;
      // 2px darker outline where a neighbour is outside every shape.
      const edge = [[-2, 0], [2, 0], [0, -2], [0, 2]].some(([ox, oy]) => !shapes.some((s) => inside(s, x + ox, y + oy)));
      const k = edge ? 0.6 : 1;
      const o = (y * SIZE + x) * 4;
      px[o] = Math.round(r * k);
      px[o + 1] = Math.round(g * k);
      px[o + 2] = Math.round(b * k);
      px[o + 3] = 255;
    }
  }
  return encodePng(SIZE, SIZE, px);
}

// ─── Manifest walk ───────────────────────────────────────────────

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Every layer file the manifest references: { gender, category, colour, rel }. */
export function listManifestLayers(manifest) {
  const out = [];
  for (const [gender, categories] of Object.entries(manifest)) {
    for (const [category, styles] of Object.entries(categories)) {
      for (const variants of Object.values(styles)) {
        for (const v of variants) {
          out.push({ gender, category, colour: v.color, rel: [gender, category, v.filename] });
        }
      }
    }
  }
  return out;
}

/**
 * Write a placeholder for every manifest layer missing under `outDir`.
 * Existing files are never touched. Returns { written, kept }.
 */
export function generatePlaceholders({ manifest, outDir }) {
  const root = resolve(outDir);
  let written = 0;
  let kept = 0;
  for (const layer of listManifestLayers(manifest)) {
    // Manifest names are URL-safe; refuse anything else and never write outside outDir.
    const target = resolve(root, ...layer.rel);
    if (!layer.rel.every((s) => SAFE_SEGMENT.test(s) && s !== '..') || !target.startsWith(root + sep)) {
      throw new Error(`refusing unsafe avatar path: ${layer.rel.join('/')}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    // Fast path only: skips rendering for layers already on disk. The 'wx' create below is what guarantees no overwrite.
    if (existsSync(target)) {
      kept++;
      continue;
    }
    try {
      writeFileSync(target, renderPlaceholder(layer.category, layer.colour), { flag: 'wx' });
      written++;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      kept++;
    }
  }
  return { written, kept };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'lib', 'avatar', 'manifest-data.json'), 'utf8'));
  const { written, kept } = generatePlaceholders({ manifest, outDir: join(ROOT, 'public', 'avatar') });
  if (written > 0) {
    console.log(`[avatar] wrote ${written} placeholder avatar layer(s) to public/avatar/ (${kept} existing kept; the real layers are not distributed, see NOTICE.md)`);
  } else if (!quiet) {
    console.log(`[avatar] all ${kept} avatar layers present; no placeholders needed`);
  }
}

// Run only when executed directly. Compare real paths on both sides: Node realpaths the main
// module, so a checkout reached through a junction, symlink or subst drive would otherwise
// never match process.argv[1] and predev/prebuild would silently generate nothing.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    const self = realpathSync.native(fileURLToPath(import.meta.url));
    const invoked = realpathSync.native(resolve(process.argv[1]));
    return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
