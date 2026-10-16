import { describe, expect, it } from 'vitest';
import {
  bodyPlanFor,
  gaitModelFor,
  matchGait,
  STRIDE_MAX_M,
  STRIDE_MIN_M,
  TIME_SCALE_MAX,
  TIME_SCALE_MIN,
  timeScaleFor,
} from '../walk-gait';

/** Stride matching from asset metadata only (bounds + Pokédex height). */

const box = (w: number, h: number, d: number) => ({ min: [-w / 2, 0, -d / 2] as [number, number, number], max: [w / 2, h, d / 2] as [number, number, number] });

describe('body plan heuristic', () => {
  it('reads long, low bodies as quadrupeds and tall, short ones as bipeds', () => {
    expect(bodyPlanFor(1.0, 1.6)).toBe('quadruped');
    expect(bodyPlanFor(1.8, 0.9)).toBe('biped');
    expect(bodyPlanFor(0.4, 0.3)).toBe('compact'); // small upright → compact
    expect(bodyPlanFor(1.0, 1.0)).toBe('compact');
  });

  it('is scale-free: model units do not change the plan', () => {
    const a = gaitModelFor({ bounds: box(1, 2, 0.8), heightm: 1.5 });
    const b = gaitModelFor({ bounds: box(100, 200, 80), heightm: 1.5 });
    expect(a.bodyPlan).toBe(b.bodyPlan);
    expect(a.walkStrideM).toBeCloseTo(b.walkStrideM, 9);
  });
});

describe('gaitModelFor', () => {
  it('scales stride with rendered height', () => {
    const small = gaitModelFor({ bounds: box(1, 2, 0.8), heightm: 0.8 });
    const big = gaitModelFor({ bounds: box(1, 2, 0.8), heightm: 2.0 });
    expect(big.walkStrideM).toBeGreaterThan(small.walkStrideM);
    expect(big.runStrideM).toBeGreaterThan(big.walkStrideM);
    expect(big.heightM).toBeCloseTo(2.0);
  });

  it('clamps the stride to a sane range', () => {
    const mite = gaitModelFor({ bounds: box(1, 1, 1), heightm: 0.1 });
    const titan = gaitModelFor({ bounds: box(1, 1, 3), heightm: 9 });
    expect(mite.walkStrideM).toBe(STRIDE_MIN_M);
    expect(titan.walkStrideM).toBe(STRIDE_MAX_M);
  });

  it('falls back to the clamped bounds height when the Pokédex height is unknown', () => {
    const m = gaitModelFor({ bounds: box(1, 50, 1), heightm: null });
    expect(m.heightM).toBeCloseTo(2);
  });
});

describe('timeScaleFor / matchGait', () => {
  it('matches speed to stride per loop', () => {
    // 1 m stride in a 1 s loop → natural 1 m/s; 1.2 m/s → 1.2×.
    expect(timeScaleFor(1.2, 1, 1)).toBeCloseTo(1.2);
    expect(timeScaleFor(0, 1, 1)).toBe(1);
    expect(timeScaleFor(1, 0, 1)).toBe(1);
  });

  it('clamps the playback rate', () => {
    expect(timeScaleFor(10, 1, 1)).toBe(TIME_SCALE_MAX);
    expect(timeScaleFor(0.1, 1, 1)).toBe(TIME_SCALE_MIN);
  });

  it('never lets the feet slide: speed = timeScale · stride / duration', () => {
    for (const desired of [0.05, 0.4, 0.9, 1.3, 5]) {
      for (const duration of [0.6, 1.0, 1.7]) {
        for (const stride of [0.3, 0.9, 2.1]) {
          const m = matchGait(desired, duration, stride);
          expect(m.matched).toBe(true);
          expect(m.speedMps).toBeCloseTo((m.timeScale * stride) / duration, 9);
          expect(m.timeScale).toBeGreaterThanOrEqual(TIME_SCALE_MIN - 1e-9);
          expect(m.timeScale).toBeLessThanOrEqual(TIME_SCALE_MAX + 1e-9);
        }
      }
    }
  });

  it('keeps the desired speed when it is inside the honest window', () => {
    const m = matchGait(1.1, 1, 1);
    expect(m.speedMps).toBeCloseTo(1.1);
    expect(m.timeScale).toBeCloseTo(1.1);
  });

  it('reports an unmatched gait when no duration was baked (pre-v3 manifest)', () => {
    expect(matchGait(0.8, null, 1)).toEqual({ speedMps: 0.8, timeScale: 1, matched: false });
    expect(matchGait(0.8, undefined, 1).matched).toBe(false);
  });
});
