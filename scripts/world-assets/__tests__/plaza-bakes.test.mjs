import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlazaMask, encodePlazaMask, sha256 } from '../bake-plaza-mask.mts';
import { buildSkyline, encodeSkyline, plazaSkylineMask } from '../bake-plaza-skyline.mjs';

/**
 * LOOK-PLAN §2 SEAT A: the plaza mask and skyline bakes are deterministic —
 * the same raster and the same encoded bytes on every run (hashes), and the
 * shipped mirror files (untracked; checked when present) are exactly the
 * current bake.
 */

const ENV = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public', 'models', 'world', 'env', 'plaza');

describe('bake-plaza-mask determinism', () => {
  it('rebuilds the same raster and the same lossless bytes', async () => {
    const a = buildPlazaMask();
    const b = buildPlazaMask();
    expect(sha256(a.data)).toBe(sha256(b.data));
    const ea = await encodePlazaMask(a);
    const eb = await encodePlazaMask(b);
    expect(sha256(ea)).toBe(sha256(eb));
    expect(ea.length).toBeLessThanOrEqual(90 * 1024 + 512);
    const shipped = join(ENV, 'mask.webp');
    if (existsSync(shipped)) expect(sha256(readFileSync(shipped))).toBe(sha256(ea));
  }, 60_000);
});

describe('bake-plaza-skyline determinism', () => {
  it('rebuilds the same atlas and the same bytes, with masked windows', async () => {
    const mask = await plazaSkylineMask();
    const a = await buildSkyline(mask);
    const b = await buildSkyline(mask);
    expect(sha256(a.data)).toBe(sha256(b.data));
    expect(a.width).toBe(2048);
    expect(a.height).toBe(512);
    // Every face-rect zone was considered, and some windows really were masked.
    expect(mask.zones).toBeGreaterThan(0);
    expect(a.masked).toBeGreaterThan(0);
    // Windows exist only inside the near silhouette (R = 255).
    for (let i = 0; i < a.data.length; i += 4) if (a.data[i + 3] > 0) expect(a.data[i]).toBe(255);
    const ea = await encodeSkyline(a);
    const eb = await encodeSkyline(b);
    expect(sha256(ea)).toBe(sha256(eb));
    expect(ea.length).toBeLessThanOrEqual(80 * 1024);
    const shipped = join(ENV, 'skyline.webp');
    if (existsSync(shipped)) expect(sha256(readFileSync(shipped))).toBe(sha256(ea));
  }, 60_000);

  it('keeps every lit window out of every padded face rect', async () => {
    const mask = await plazaSkylineMask();
    const a = await buildSkyline(mask);
    const W = a.width;
    const H = a.height;
    let checked = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (a.data[(y * W + x) * 4 + 3] === 0) continue;
        checked += 1;
        expect(mask.isInsideRect((x + 0.5) / W, 1 - (y + 0.5) / H)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);
});
