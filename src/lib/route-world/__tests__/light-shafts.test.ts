import { describe, expect, it } from 'vitest';
import { stationPose, themeKeepOut, wedgeHitsSphere } from '../data-surfaces';
import {
  SHAFT_AXIS_SAMPLES,
  SHAFT_LIMITS,
  SHAFT_MAX,
  SHAFT_MAX_LINEAR,
  SHAFT_MIN_VISIBLE_M,
  SHAFT_POOL_SPACING_M,
  plazaShaftSeats,
  poolInTargetBox,
  shaftAxisSamples,
  shaftClears,
  shaftSampleRadius,
  shaftTop,
  shaftVisibleMetres,
  solveShaftSeats,
} from '../light-shafts';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { plazaCanopies } from '@/components/world/evoliga/route/plaza/tree-skin';
import { plazaTheme } from '@/components/world/themes/plaza/theme';

/**
 * LOOK-PLAN §2 SEAT M — the rules sun shafts' placement law: no axis sample
 * of any shipped shaft inside any keep-out wedge at any pose, pools in the
 * target box, and the shipped table equal to the solver's own output.
 */

const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
const seats = plazaShaftSeats();
const rulesIndex = PLAZA_DATA_SURFACES.stations.findIndex((station) => station.id === 'rules');
const rulesDesktop = stationPose(PLAZA_DATA_SURFACES, rulesIndex, 'desktop');
const frame = { camera: rulesDesktop.camera, viewport: rulesDesktop.viewport };
const KEY = plazaTheme.lights.keyDirection;

describe('plaza shaft seats — keep-out (every wedge, every pose)', () => {
  it('ships between 1 and SHAFT_MAX seats', () => {
    expect(seats.length).toBeGreaterThanOrEqual(1);
    expect(seats.length).toBeLessThanOrEqual(SHAFT_MAX);
    expect(SHAFT_MAX).toBe(3);
  });

  it('the wedge set covers the rules faces from desktop, 390, focus and dolly eyes', () => {
    const rulesKinds = new Set(keepOut.wedges.filter((w) => w.stationId === 'rules').map((w) => w.poseKind));
    for (const kind of ['desktop', 'landed390', 'focus', 'dolly'] as const) expect(rulesKinds.has(kind)).toBe(true);
  });

  it('no axis sample of any shaft reaches into any wedge', () => {
    for (const seat of seats) {
      const samples = shaftAxisSamples(seat);
      expect(samples).toHaveLength(SHAFT_AXIS_SAMPLES);
      const r = shaftSampleRadius(seat.width);
      for (const p of samples) {
        const hits = keepOut.wedges.filter((w) => wedgeHitsSphere(w, p, r)).map((w) => `${w.faceId}@${w.poseId}`);
        expect(hits, `${seat.id} sample ${p.map((v) => v.toFixed(2)).join(',')}`).toEqual([]);
      }
      expect(shaftClears(keepOut, seat)).toBe(true);
    }
  });

  it('has teeth: a beam landing under the left plaque is caught', () => {
    const pool = [-4, 0, 7] as const;
    const bad = { pool, top: shaftTop(pool, KEY, 20), width: 0.9 };
    expect(shaftClears(keepOut, bad)).toBe(false);
  });
});

describe('plaza shaft seats — geometry', () => {
  it('every pool sits in the target box, on the ground', () => {
    for (const seat of seats) {
      expect(poolInTargetBox(seat.pool), seat.id).toBe(true);
      expect(seat.pool[1]).toBe(0);
    }
  });

  it('every axis runs up the key direction, within the length and width limits', () => {
    const len = Math.hypot(KEY[0], KEY[1], KEY[2]);
    for (const seat of seats) {
      expect(seat.length).toBeGreaterThanOrEqual(SHAFT_LIMITS.length[0]);
      expect(seat.length).toBeLessThanOrEqual(SHAFT_LIMITS.length[1]);
      expect(seat.width).toBeGreaterThanOrEqual(SHAFT_LIMITS.width[0]);
      expect(seat.width).toBeLessThanOrEqual(SHAFT_LIMITS.width[1]);
      const axis = [seat.top[0] - seat.pool[0], seat.top[1] - seat.pool[1], seat.top[2] - seat.pool[2]];
      const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
      expect(axisLen).toBeCloseTo(seat.length, 2);
      for (let i = 0; i < 3; i += 1) expect(axis[i] / axisLen).toBeCloseTo(KEY[i] / len, 3);
      expect(seat.top[1]).toBeGreaterThan(seat.pool[1]);
    }
  });

  it('pools stand apart, so the beams never merge into one slab', () => {
    for (let i = 0; i < seats.length; i += 1) {
      for (let j = i + 1; j < seats.length; j += 1) {
        const d = Math.hypot(seats[i].pool[0] - seats[j].pool[0], seats[i].pool[2] - seats[j].pool[2]);
        expect(d).toBeGreaterThanOrEqual(SHAFT_POOL_SPACING_M - 1e-9);
      }
    }
  });

  it('every beam shows its lower run to the rules desktop eye', () => {
    for (const seat of seats) expect(shaftVisibleMetres(seat, frame)).toBeGreaterThanOrEqual(SHAFT_MIN_VISIBLE_M);
  });

  it('the additive ceiling stays under the LOOK r4 cap (+0.8 linear: the r3 +0.2 beams did not read under AgX; calm-masked off every face)', () => {
    expect(SHAFT_MAX_LINEAR).toBeLessThanOrEqual(0.8);
  });
});

describe('solveShaftSeats — the table is the solver output', () => {
  it('re-solving under the plaza keep-out reproduces the shipped seats exactly', () => {
    const solved = solveShaftSeats({ keepOut, keyDirection: KEY, canopies: plazaCanopies(), frame });
    expect(solved).toEqual(seats);
  });

  it('is deterministic', () => {
    const input = { keepOut, keyDirection: KEY, canopies: plazaCanopies(), frame };
    expect(JSON.stringify(solveShaftSeats(input))).toBe(JSON.stringify(solveShaftSeats(input)));
  });

  it('ships fewer, never a loosened pad: a keep-out that blocks the whole box seats nothing', () => {
    const blocked = { ...keepOut, sphereClear: () => false };
    expect(solveShaftSeats({ keepOut: blocked, keyDirection: KEY, canopies: plazaCanopies(), frame })).toEqual([]);
  });
});
