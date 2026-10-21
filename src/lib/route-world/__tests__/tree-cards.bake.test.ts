import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createCanvas, loadImage } from 'canvas';
import { TREE_SKINS, type BarkPalette, type LeafPalette } from '../tree';
import {
  BARK_CARD_SIZE,
  LEAF_ALPHA_TEST,
  LEAF_CARD_SIZE,
  paintBarkCardData,
  paintLeafCardData,
  skinSeed,
} from '@/components/world/route/trees/tree-cards';

/**
 * The procedural card BAKE OF RECORD (C-100 criterion 3).
 *
 * The bark + leaf-cluster card sets are authored procedurally — pure pixel
 * fields in `tree-cards.ts`, the plaza stone-maps idiom. This test
 * double-serves as (a) the paint's compliance unit test (determinism,
 * opaque bark, the baked alpha seam) and (b) the bake that ships the cards
 * under `public/textures/world/`: it re-paints every card and rewrites the
 * PNG whenever the shipped file no longer matches the painter's output
 * byte-for-byte, so the shipped cards can never drift from the authored
 * source. The PNG encoder below is deterministic (no canvas round-trip in
 * the encode path), so a warm re-bake is byte-stable. No AI generation
 * anywhere.
 */

const OUT_DIR = join(process.cwd(), 'public', 'textures', 'world');

/** PNG chunk CRC-32 (the standard, reflected polynomial 0xEDB88320). */
const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = -1;
  for (let i = 0; i < data.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * Minimal deterministic RGBA PNG encoder: filter 0 per scanline, zlib
 * deflate. Byte-stable for identical input — the bake of record.
 */
function encodePng(data: Uint8ClampedArray, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size * 4; x += 1) raw[y * (size * 4 + 1) + 1 + x] = data[y * size * 4 + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The exact pixels the runtime texture wraps (same row flip as cardDataTexture). */
function flipped(data: Uint8Array, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const row = size * 4;
  for (let y = 0; y < size; y += 1) {
    out.set(data.subarray((size - 1 - y) * row, (size - 1 - y) * row + row), y * row);
  }
  return out;
}

function paintAll(): { file: string; size: number; data: Uint8ClampedArray }[] {
  const cards: { file: string; size: number; data: Uint8ClampedArray }[] = [];
  for (const skin of TREE_SKINS) {
    const bark: BarkPalette = skin.bark;
    const leafA: LeafPalette = skin.leafA;
    const leafB: LeafPalette = skin.leafB;
    cards.push({
      file: `bark-${skin.id}.png`,
      size: BARK_CARD_SIZE,
      data: flipped(paintBarkCardData(bark, skinSeed(skin.id, 1)), BARK_CARD_SIZE),
    });
    cards.push({
      file: `leaves-${skin.id}-a.png`,
      size: LEAF_CARD_SIZE,
      data: flipped(paintLeafCardData(leafA, 'A', skinSeed(skin.id, 2)), LEAF_CARD_SIZE),
    });
    cards.push({
      file: `leaves-${skin.id}-b.png`,
      size: LEAF_CARD_SIZE,
      data: flipped(paintLeafCardData(leafB, 'B', skinSeed(skin.id, 3)), LEAF_CARD_SIZE),
    });
  }
  return cards;
}

/**
 * Decode a shipped PNG to RGBA pixels, or null when it does not exist.
 * (canvas drawImage premultiplies, so the DECODED comparison below checks
 * alpha everywhere and RGB where the card is opaque; the byte-exact
 * guarantee is the encoder's, verified by the rewrite-on-drift logic.)
 */
async function decode(path: string, size: number): Promise<Uint8ClampedArray | null> {
  if (!existsSync(path)) return null;
  const image = await loadImage(readFileSync(path));
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

/** Alpha-everywhere, RGB-where-opaque equality (canvas round-trip tolerance). */
function sameRender(shipped: Uint8ClampedArray | null, data: Uint8ClampedArray): boolean {
  if (!shipped || shipped.length !== data.length) return false;
  for (let i = 0; i < data.length; i += 4) {
    if (shipped[i + 3] !== data[i + 3]) return false;
    if (data[i + 3] === 255) {
      if (shipped[i] !== data[i] || shipped[i + 1] !== data[i + 1] || shipped[i + 2] !== data[i + 2]) return false;
    }
  }
  return true;
}

describe('procedural card paint — compliance', () => {
  it('is deterministic per skin and differs across skins', () => {
    const [sakura, mountain] = TREE_SKINS;
    const a = paintLeafCardData(sakura.leafA, 'A', skinSeed(sakura.id, 2));
    const b = paintLeafCardData(sakura.leafA, 'A', skinSeed(sakura.id, 2));
    const c = paintLeafCardData(mountain.leafA, 'A', skinSeed(mountain.id, 2));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('bark cards are fully opaque', () => {
    for (const skin of TREE_SKINS) {
      const data = paintBarkCardData(skin.bark, skinSeed(skin.id, 1));
      for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
    }
  });

  it('leaf cards bake the alpha seam: alpha reaches 0 on the border, cut sits inside the fade', () => {
    for (const skin of TREE_SKINS) {
      for (const set of ['A', 'B'] as const) {
        const seed = skinSeed(skin.id, set === 'A' ? 2 : 3);
        const leaf = set === 'A' ? skin.leafA : skin.leafB;
        const data = paintLeafCardData(leaf, set, seed);
        const size = LEAF_CARD_SIZE;
        // The destination-in-equivalent fade completes BEFORE
        // the texture border — every border pixel is fully transparent, so
        // the alphaTest cut can never sit on a rectangle edge.
        const border: number[] = [];
        for (let x = 0; x < size; x += 1) {
          border.push(data[x * 4 + 3], data[((size - 1) * size + x) * 4 + 3]);
        }
        for (let y = 0; y < size; y += 1) {
          border.push(data[(y * size) * 4 + 3], data[(y * size + size - 1) * 4 + 3]);
        }
        for (const alpha of border) expect(alpha).toBe(0);
        // A healthy cluster interior above the alphaTest cut.
        let solid = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] >= LEAF_ALPHA_TEST * 255) solid += 1;
        expect(solid / (size * size)).toBeGreaterThan(0.15);
      }
    }
  });

  it('the two leaf-cluster sets of a skin paint distinct cards', () => {
    for (const skin of TREE_SKINS) {
      const a = paintLeafCardData(skin.leafA, 'A', skinSeed(skin.id, 2));
      const b = paintLeafCardData(skin.leafB, 'B', skinSeed(skin.id, 3));
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    }
  });
});

describe('public/textures/world bake', () => {
  // Nine 256² paints + deterministic PNG encode + decode verification —
  // tight standalone, but the full suite runs this alongside 380 other
  // files, so give the bake its own generous budget.
  it('ships every card byte-identical to the deterministic encoder', { timeout: 60_000 }, async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const cards = paintAll();
    expect(cards).toHaveLength(9);
    for (const card of cards) {
      const path = join(OUT_DIR, card.file);
      const expected = encodePng(card.data, card.size);
      const shipped = existsSync(path) ? readFileSync(path) : null;
      if (!shipped || !Buffer.from(shipped).equals(expected)) {
        writeFileSync(path, expected);
      }
      // Double-verify the encoder: the shipped bytes re-encode identically
      // AND decode back to the painter's render (alpha-exact everywhere,
      // RGB exact where the card is opaque).
      expect(Buffer.from(readFileSync(path)).equals(expected)).toBe(true);
      expect(sameRender(await decode(path, card.size), card.data)).toBe(true);
    }
  });
});
