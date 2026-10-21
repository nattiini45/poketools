import { describe, expect, it } from 'vitest';
import { paintLeafCardData } from '../tree-cards';

/**
 * ENGINE r3: `paintLeafCardData` was a 0.66 s load-time task on dev (the
 * plaza's two skins). Its per-blob rotation is now hoisted and pixels outside
 * a blob's bounding circle skip it. The goldens below were taken from the
 * pre-change implementation (byte-compared against it for these inputs), so
 * the speed-up is pinned as pixel-identical.
 */
function fnv(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const PALETTE = {
  base: { r: 60, g: 110, b: 50 },
  lit: { r: 120, g: 170, b: 90 },
  shadow: { r: 30, g: 60, b: 30 },
  bloom: { r: 250, g: 200, b: 220 },
  bloomShare: 0.4,
};

const CASES = [
  { set: 'A', seed: 1, bloom: true, golden: 'bc6940fc' },
  { set: 'B', seed: 7, bloom: true, golden: '249b28a7' },
  { set: 'A', seed: 12345, bloom: false, golden: '2d73b066' },
  { set: 'B', seed: 99, bloom: false, golden: '4c902262' },
] as const;

describe('leaf card paint (ENGINE r3 speed-up is pixel-identical)', () => {
  it.each(CASES)('set $set seed $seed bloom $bloom matches the pre-change golden', ({ set, seed, bloom, golden }) => {
    const palette = bloom ? PALETTE : { ...PALETTE, bloom: null, bloomShare: 0 };
    const data = paintLeafCardData(palette as Parameters<typeof paintLeafCardData>[0], set, seed);
    expect(fnv(data)).toBe(golden);
  });
});
