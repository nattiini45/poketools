import { expect } from 'vitest';

/**
 * The PLATFORM snapshots were written on Windows. Values that pass through the platform libm (sRGB<->linear
 * `Math.pow` in THREE.Color, trig in ring geometry) can land one ULP apart on Linux, e.g. 0.7912979403281551
 * vs 0.7912979403281553. The snapshots pin values, not ULPs: every finite number of the expected side
 * becomes `expect.closeTo(n, 12)`, so any real change (over 5e-13) still fails.
 */
export function ulpSafe(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? expect.closeTo(value, 12) : value;
  if (Array.isArray(value)) return value.map(ulpSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ulpSafe(entry)]));
  }
  return value;
}

/** A float32 weighted sum, equal to the snapshot within a relative 1e-9 (one ULP flip in one vertex is ~1e-10). */
export function expectSumClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
}
