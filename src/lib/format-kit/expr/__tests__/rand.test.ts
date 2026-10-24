import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../test-utils/prng';
import { seededRand } from '../rand';

/**
 * Pinned vectors. Stored definitions depend on these exact values: a change here is a deliberate
 * break of every stored `seeded_rand`, not a refactor.
 */
const VECTORS: [string, string, string, number][] = [
  ['', '', '', 0.5460636515635997],
  ['seed', 'scope', 'key', 0.14951640297658741],
  ['season-1', 'stage:league', 'coin', 0.5674050077795982],
  ['a', 'b', 'c', 0.29950602422468364],
  ['a', 'b', 'd', 0.7370230187661946],
  ['a', 'c', 'c', 0.750877914018929],
  ['b', 'b', 'c', 0.21372653171420097],
  ['ünï', '日本', 'k\u{1f600}', 0.3169574737548828],
];

describe('seededRand', () => {
  it.each(VECTORS)('pinned vector (%j, %j, %j)', (seed, scope, key, expected) => {
    expect(seededRand(seed, scope, key)).toBe(expected);
  });

  it('is deterministic', () => {
    for (let i = 0; i < 50; i += 1) expect(seededRand('s', 'x', `k${i}`)).toBe(seededRand('s', 'x', `k${i}`));
  });

  it('changes with seed, scope and key', () => {
    const base = seededRand('a', 'b', 'c');
    expect(seededRand('b', 'b', 'c')).not.toBe(base);
    expect(seededRand('a', 'c', 'c')).not.toBe(base);
    expect(seededRand('a', 'b', 'd')).not.toBe(base);
  });

  it('separates the three parts, so moving text between them changes the result', () => {
    expect(seededRand('ab', 'c', 'd')).not.toBe(seededRand('a', 'bc', 'd'));
    expect(seededRand('a', 'bc', 'd')).not.toBe(seededRand('a', 'b', 'cd'));
  });

  it('stays in [0, 1) with a sensible distribution over 10000 keys', () => {
    let sum = 0;
    let min = 1;
    let max = 0;
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i += 1) {
      const v = seededRand('smoke', 'dist', `key-${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
      buckets[Math.floor(v * 10)] += 1;
    }
    expect(Math.abs(sum / 10_000 - 0.5)).toBeLessThan(0.02);
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
    for (const count of buckets) expect(count).toBeGreaterThan(850);
  });
});

describe('test PRNG', () => {
  it('mulberry32 is reproducible and in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
