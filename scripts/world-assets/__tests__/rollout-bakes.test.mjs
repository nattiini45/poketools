import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLOUDS_MASK,
  CLOUDS_SKYLINE_ATLAS,
  MOUNTAIN_MASK,
  MOUNTAIN_SKYLINE_ATLAS,
  SAKURA_MASK,
  SAKURA_SKYLINE_ATLAS,
} from '../../../src/lib/route-world/world-env';
import { buildCloudsFarRing, ATLAS as CLOUDS_ATLAS } from '../bake-clouds-farring.mjs';
import { buildCloudsMask } from '../bake-clouds-mask.mts';
import { buildGrassCard, encodeGrassCard } from '../bake-grass-card.mjs';
import { buildMountainMask } from '../bake-mountain-mask.mts';
import { buildMountainRidges, ATLAS as MOUNTAIN_ATLAS } from '../bake-mountain-ridges.mjs';
import { buildSakuraMask } from '../bake-sakura-mask.mts';
import { buildSakuraSkyline, ATLAS as SAKURA_ATLAS } from '../bake-sakura-skyline.mjs';
import { ROLLOUT_DERIVED } from '../env-assets.mjs';
import { encodeLosslessRgba, sha256Hex } from '../lib.mjs';
import { renderRolloutSet, rolloutSets } from '../paint-bake.mjs';
import { cachedMapPath } from '../env-assets.mjs';

/**
 * ROLLOUT-PLAN §3.3 item 6: every B4 bake is deterministic — the same raster
 * and the same encoded bytes on every run (hashes) — and the shipped mirror
 * files (untracked; checked when present) are exactly the current bake.
 * Item 3: the forced-zero channel (B) is 0 on every dry-band / wedge texel.
 * §5: the new shipped bytes per world stay under the caps.
 */

const ENV = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public', 'models', 'world', 'env');

function shippedMatches(rel, bytes) {
  const file = join(ENV, rel);
  if (existsSync(file)) expect(sha256Hex(readFileSync(file))).toBe(sha256Hex(bytes));
}

const SKYLINES = [
  { name: 'sakura', build: buildSakuraSkyline, atlas: SAKURA_ATLAS, constant: SAKURA_SKYLINE_ATLAS, cap: 40 },
  { name: 'mountain', build: buildMountainRidges, atlas: MOUNTAIN_ATLAS, constant: MOUNTAIN_SKYLINE_ATLAS, cap: 150 },
  { name: 'clouds', build: buildCloudsFarRing, atlas: CLOUDS_ATLAS, constant: CLOUDS_SKYLINE_ATLAS, cap: 80 },
];

describe.each(SKYLINES)('$name skyline atlas', ({ build, atlas, constant, cap }) => {
  it('mirrors the world-env constant', () => {
    expect({ ...atlas, radii: [...atlas.radii], topElevationDeg: [...atlas.topElevationDeg] }).toEqual({
      ...constant,
      radii: [...constant.radii],
      topElevationDeg: [...constant.topElevationDeg],
    });
  });

  it('rebuilds the same raster and bytes, with A = 0 and a seamless wrap', async () => {
    const a = build();
    const b = build();
    expect(sha256Hex(a.data)).toBe(sha256Hex(b.data));
    expect([a.width, a.height]).toEqual([constant.width, constant.height]);
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== 0) throw new Error(`A ≠ 0 at texel ${(i - 3) / 4}`);
    // Every band covers the bottom row everywhere, and the first / last columns agree closely (periodic shapes).
    const W = a.width;
    const H = a.height;
    for (let ch = 0; ch < 3; ch += 1) {
      for (let x = 0; x < W; x += 1) expect(a.data[((H - 1) * W + x) * 4 + ch]).toBe(255);
      let diff = 0;
      for (let y = 0; y < H; y += 1) diff += Math.abs(a.data[(y * W) * 4 + ch] - a.data[(y * W + W - 1) * 4 + ch]);
      expect(diff / H).toBeLessThan(12);
    }
    const ea = await encodeLosslessRgba(a);
    const eb = await encodeLosslessRgba(b);
    expect(sha256Hex(ea)).toBe(sha256Hex(eb));
    expect(ea.length).toBeLessThanOrEqual(cap * 1024);
    shippedMatches(constant.file.replace(/^env\//, ''), ea);
  }, 60_000);
});

const MASKS = [
  { name: 'sakura', build: buildSakuraMask, layout: SAKURA_MASK },
  { name: 'mountain', build: buildMountainMask, layout: MOUNTAIN_MASK },
  { name: 'clouds', build: buildCloudsMask, layout: CLOUDS_MASK },
];

describe.each(MASKS)('$name story mask', ({ build, layout }) => {
  it('is deterministic, zero-bordered, and B is 0 on every dry / wedge texel', async () => {
    const a = build();
    const b = build();
    expect(sha256Hex(a.data)).toBe(sha256Hex(b.data));
    expect(a.dry.zones).toBeGreaterThan(0);
    expect(a.dry.wedges).toBeGreaterThan(0);
    const S = a.size;
    expect(S).toBe(layout.size);
    let forbidden = 0;
    for (let t = 0; t < S * S; t += 1) {
      if (a.forbidden[t]) {
        forbidden += 1;
        if (a.data[t * 4 + 2] !== 0) throw new Error(`B ≠ 0 on forbidden texel ${t}`);
      }
      const row = Math.floor(t / S);
      const col = t % S;
      if (row === 0 || col === 0 || row === S - 1 || col === S - 1) {
        for (let c = 0; c < 4; c += 1) if (a.data[t * 4 + c] !== 0) throw new Error(`border texel ${t} ≠ 0`);
      }
    }
    expect(forbidden).toBeGreaterThan(0);
    const ea = await encodeLosslessRgba(a);
    const eb = await encodeLosslessRgba(b);
    expect(sha256Hex(ea)).toBe(sha256Hex(eb));
    expect(ea.length).toBeLessThanOrEqual(90 * 1024);
    shippedMatches(layout.file.replace(/^env\//, ''), ea);
  }, 120_000);
});

describe('sakura grass card', () => {
  it('is deterministic', async () => {
    const a = buildGrassCard();
    const b = buildGrassCard();
    expect(sha256Hex(a.data)).toBe(sha256Hex(b.data));
    const ea = await encodeGrassCard(a);
    expect(sha256Hex(ea)).toBe(sha256Hex(await encodeGrassCard(b)));
    expect(ea.length).toBeLessThanOrEqual(20 * 1024);
    shippedMatches('sakura/grass-card.webp', ea);
  }, 240_000); // bakes the card twice: ~24 s plain, 2-3x that under v8 coverage
});

describe('rollout painted sets', () => {
  const sets = rolloutSets('all');

  it('lists exactly the attributed derived sets', () => {
    expect(sets.map((s) => s.role).sort()).toEqual(ROLLOUT_DERIVED.map(([role]) => role).sort());
  });

  const cached = sets.every((set) =>
    (set.kind === 'normal' ? ['nor'] : set.cavity ? ['diff', 'nor', 'disp'] : ['diff', 'nor']).every((m) => existsSync(cachedMapPath(set.source, m))),
  );

  it.skipIf(!cached)('re-bakes byte-identically (and equal to the shipped files)', async () => {
    const snow = sets.find((s) => s.role === 'mountain-snow');
    const once = await renderRolloutSet(snow);
    const twice = await renderRolloutSet(snow);
    expect(sha256Hex(once.nor)).toBe(sha256Hex(twice.nor));
    for (const set of sets) {
      const out = await renderRolloutSet(set);
      for (const [map, bytes] of Object.entries(out)) shippedMatches(`tex/${set.role}/${map}.webp`, bytes);
    }
  }, 240_000);
});

describe('§5 byte budget (new shipped files per world)', () => {
  const CAP_KB = { sakura: 0.8 * 1024, mountain: 0.9 * 1024, clouds: 0.6 * 1024 };
  const AUTHORED = {
    sakura: ['sakura/skyline.webp', 'sakura/mask.webp', 'sakura/grass-card.webp'],
    mountain: ['mountain/skyline.webp', 'mountain/mask.webp'],
    clouds: ['clouds/skyline.webp', 'clouds/mask.webp'],
  };
  const present = Object.values(AUTHORED).flat().every((rel) => existsSync(join(ENV, rel)));

  it.skipIf(!present)('stays under the caps', () => {
    for (const world of ['sakura', 'mountain', 'clouds']) {
      let bytes = 0;
      for (const set of rolloutSets(world)) {
        for (const map of ['diff', 'nor']) {
          const file = join(ENV, 'tex', set.role, `${map}.webp`);
          if (existsSync(file)) bytes += statSync(file).size;
        }
      }
      for (const rel of AUTHORED[world]) bytes += statSync(join(ENV, rel)).size;
      expect(bytes / 1024, world).toBeLessThanOrEqual(CAP_KB[world]);
    }
  });
});
