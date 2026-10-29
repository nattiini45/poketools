import { describe, expect, it } from 'vitest';
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { PLAN_ENGINE_SUPPORT } from '../engine-support';

/**
 * `PLAN_ENGINE_SUPPORT` is a constant table row "unit-tested against the constant it describes" (spec §18.13): the day
 * the engine plays a second circle this fails, and the row (plus the `engine_support` reader) flips with it.
 */
describe('PLAN_ENGINE_SUPPORT', () => {
  it('describes the engine: one circle, n-1 rounds for an even field and n for an odd one (a bye each round)', () => {
    expect(PLAN_ENGINE_SUPPORT.roundRobinLegs).toBe(1);
    for (const n of [2, 3, 4, 7, 8, 11, 12, 16]) {
      const circle = n % 2 === 0 ? n - 1 : n;
      expect(getRoundRobinTotalRounds(n), `n=${n}`).toBe(circle * PLAN_ENGINE_SUPPORT.roundRobinLegs);
    }
  });

  it('cannot be changed by accident', () => {
    expect(Object.isFrozen(PLAN_ENGINE_SUPPORT)).toBe(true);
  });
});
