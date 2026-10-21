/**
 * LOOK-PLAN §2 SEAT A — the plaza storytelling ground law (`plaza-ground.ts`)
 * and the baked story mask it drives (`scripts/world-assets/bake-plaza-mask.mts`).
 *
 * 1. The DRY BAND covers every footer band at every reading pose: rays cast
 *    through a grid over [face bottom, face bottom + 18 % viewport height] ×
 *    the padded face width, from every landed (1440 / 768 / 390) and focus
 *    pose of every plaza data face, land on ground whose mask puddle value is 0.
 * 2. Puddle B = 0 inside every keep-out wedge.
 * 3. Medallion constants (r ≈ 2.9 m, ΔL ≤ 15, no text) and the mask mapping.
 *
 * The raster is built in-process (the bake's own function), so this runs in
 * CI without the untracked mirror; when the mirror file exists, its decoded
 * pixels must equal the in-process raster (lossless encode).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { buildPlazaMask, type PlazaMaskRaster } from '../../../../scripts/world-assets/bake-plaza-mask.mjs';
import { faceRectAt, KEEP_OUT_PAD } from '../data-surfaces';
import { PLAZA } from '../layout';
import {
  createDryBand,
  DRY_BAND_VIEWPORT,
  dryBandPoses,
  footerBandRect,
  LAMP_SEATS,
  LANE_ANCHORS,
  MEDALLION,
  maskTexelToWorld,
  PLAZA_GROUND_PLANE,
  PLAZA_MASK,
  screenToGround,
  worldToMaskTexel,
  worldToMaskUv,
} from '../plaza-ground';
import { PLAZA_LAMP_SEATS } from '../teams-formation';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const MASK_FILE = join(REPO_ROOT, 'public', 'models', 'world', 'env', 'plaza', 'mask.webp');

let raster: PlazaMaskRaster;

beforeAll(() => {
  raster = buildPlazaMask(PLAZA_DATA_SURFACES);
}, 60_000);

function puddleAt(x: number, z: number): number | null {
  const texel = worldToMaskTexel(x, z);
  if (!texel) return null;
  return raster.data[(texel[1] * PLAZA_MASK.size + texel[0]) * 4 + 2];
}

describe('plaza ground mapping', () => {
  it('maps mask texels to world and back (row 0 = north, v = 1 at the top row)', () => {
    for (const [c, r] of [
      [0, 0],
      [511, 0],
      [256, 300],
      [511, 511],
    ] as const) {
      const [x, z] = maskTexelToWorld(c, r);
      expect(worldToMaskTexel(x, z)).toEqual([c, r]);
    }
    const half = PLAZA_GROUND_PLANE.size / 2;
    expect(PLAZA_GROUND_PLANE.size).toBe(42);
    expect(worldToMaskUv(-half, -half)).toEqual([0, 1]);
    expect(worldToMaskUv(half, half)).toEqual([1, 0]);
    expect(worldToMaskTexel(half + 0.1, 0)).toBeNull();
  });

  it('re-exports the renderer lamp seats (no restated literals)', () => {
    expect(LAMP_SEATS).toBe(PLAZA_LAMP_SEATS);
  });
});

describe('medallion constants', () => {
  it('is the r ≈ 2.9 m Poké Ball compass, stone-quiet (ΔL ≤ 15), inside the plaza', () => {
    expect(MEDALLION.radius).toBeCloseTo(2.9, 5);
    expect(MEDALLION.maxDeltaL).toBeLessThanOrEqual(15);
    expect(MEDALLION.center).toEqual([0, 0]);
    expect(MEDALLION.buttonInner).toBeLessThan(MEDALLION.buttonOuter);
    expect(MEDALLION.buttonOuter).toBeLessThan(MEDALLION.radius - MEDALLION.ringWidth);
    expect(MEDALLION.bandHalf * 2).toBeLessThan(MEDALLION.buttonOuter * 2);
    expect(MEDALLION.radius + MEDALLION.tickLength).toBeLessThan(PLAZA.half);
  });

  it('has one lane per station forecourt, each inside the plaza', () => {
    expect(LANE_ANCHORS.map((lane) => lane.station).sort()).toEqual(
      PLAZA_DATA_SURFACES.stations.map((s) => s.id).sort(),
    );
    for (const lane of LANE_ANCHORS) {
      expect(Math.max(Math.abs(lane.at[0]), Math.abs(lane.at[1]))).toBeLessThan(PLAZA.half);
    }
  });
});

describe('dry band', () => {
  it('covers every footer band at every reading pose (mask puddle B = 0 under every footer)', () => {
    const band = createDryBand(PLAZA_DATA_SURFACES);
    let samples = 0;
    const wet: string[] = [];
    for (const face of PLAZA_DATA_SURFACES.faces) {
      const poses = dryBandPoses(PLAZA_DATA_SURFACES, face);
      expect(poses.some((p) => p.kind === 'landed390')).toBe(true);
      expect(poses.some((p) => p.kind === 'focus')).toBe(true);
      for (const pose of poses) {
        const rect = footerBandRect(face, pose);
        const projected = faceRectAt(face, pose.camera, pose.viewport, KEEP_OUT_PAD.metres);
        if (!rect || !projected.fullRect) continue;
        // Half a pixel inside the band: its edges are the solver's exact boundaries.
        const bottom = Math.max(0, projected.fullRect.y + projected.fullRect.h) + 0.5;
        const y1 = Math.min(pose.viewport.height, bottom + DRY_BAND_VIEWPORT * pose.viewport.height) - 1;
        const x0 = rect.x0 + 0.5;
        const x1 = rect.x1 - 0.5;
        if (y1 <= bottom || x1 <= x0) continue;
        for (let iy = 0; iy <= 8; iy += 1) {
          const sy = bottom + ((y1 - bottom) * iy) / 8;
          for (let ix = 0; ix <= 16; ix += 1) {
            const sx = x0 + ((x1 - x0) * ix) / 16;
            const hit = screenToGround(pose, sx, sy);
            if (!hit) continue;
            const b = puddleAt(hit[0], hit[1]);
            if (b === null) continue;
            samples += 1;
            if (!band.isDry(hit[0], hit[1])) wet.push(`${pose.id} solver miss at ${hit.map((v) => v.toFixed(2))}`);
            if (b !== 0) wet.push(`${pose.id} B=${b} at ${hit.map((v) => v.toFixed(2))}`);
          }
        }
      }
    }
    expect(samples).toBeGreaterThan(500);
    expect(wet).toEqual([]);
  });

  it('keeps puddle B = 0 inside every keep-out wedge', () => {
    const band = createDryBand(PLAZA_DATA_SURFACES);
    expect(band.wedges.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (let row = 0; row < PLAZA_MASK.size; row += 2) {
      for (let col = 0; col < PLAZA_MASK.size; col += 2) {
        const [x, z] = maskTexelToWorld(col, row);
        if (!band.inWedge(x, z)) continue;
        const b = raster.data[(row * PLAZA_MASK.size + col) * 4 + 2];
        if (b !== 0) leaks.push(`${col},${row}=${b}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('still leaves puddles for the night story (outside the law)', () => {
    let puddles = 0;
    for (let i = 2; i < raster.data.length; i += 4) if (raster.data[i] > 32) puddles += 1;
    expect(puddles / (PLAZA_MASK.size * PLAZA_MASK.size)).toBeGreaterThan(0.05);
  });
});

describe('shipped mask', () => {
  it.skipIf(!existsSync(MASK_FILE))('decodes to exactly the in-process raster (lossless, current)', async () => {
    const { data, info } = await sharp(readFileSync(MASK_FILE)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(PLAZA_MASK.size);
    expect(info.channels).toBe(4);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(raster.data))).toBe(0);
  });
});
