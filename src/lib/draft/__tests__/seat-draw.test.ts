import { describe, expect, it, vi } from 'vitest';
import { drawSeatOrder } from '../seat-draw';

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** A deterministic RNG: replays the given values, wrapped into the asked range. */
function scripted(values: number[]) {
  let next = 0;
  return vi.fn((max: number) => values[next++ % values.length] % max);
}

describe('drawSeatOrder', () => {
  it('returns a permutation of the ids and leaves the input untouched', () => {
    const input = [...IDS];
    const order = drawSeatOrder(input, scripted([3, 1, 4, 1, 5]));
    expect([...order].sort()).toEqual([...IDS].sort());
    expect(input).toEqual(IDS);
  });

  it('draws once per swap, each time from a shrinking range (Fisher-Yates)', () => {
    const rng = scripted([0]);
    drawSeatOrder(IDS, rng);
    expect(rng.mock.calls.map(([max]) => max)).toEqual([6, 5, 4, 3, 2]);
  });

  it('is deterministic for a fixed RNG', () => {
    const first = drawSeatOrder(IDS, scripted([2, 0, 3, 1, 1]));
    const second = drawSeatOrder(IDS, scripted([2, 0, 3, 1, 1]));
    expect(first).toEqual(second);
    expect(first).not.toEqual(IDS);
  });

  it('follows the RNG: always drawing the last index keeps the order, always drawing 0 rotates it', () => {
    expect(drawSeatOrder(IDS, (max) => max - 1)).toEqual(IDS);
    expect(drawSeatOrder(IDS, () => 0)).toEqual(['b', 'c', 'd', 'e', 'f', 'a']);
  });

  it('handles zero, one and two ids', () => {
    const rng = vi.fn(() => 0);
    expect(drawSeatOrder([], rng)).toEqual([]);
    expect(drawSeatOrder(['a'], rng)).toEqual(['a']);
    expect(rng).not.toHaveBeenCalled();
    expect(drawSeatOrder(['a', 'b'], () => 0)).toEqual(['b', 'a']);
  });

  it('with the default RNG still returns a permutation, and reaches more than one order', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const order = drawSeatOrder(IDS);
      expect([...order].sort()).toEqual([...IDS].sort());
      seen.add(order.join(','));
    }
    // 720 permutations: 60 draws landing on one order has a chance of about 720^-59.
    expect(seen.size).toBeGreaterThan(1);
  });
});
