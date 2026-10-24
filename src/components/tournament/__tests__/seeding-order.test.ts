import { describe, expect, it } from 'vitest';
import { buildSeedPayload, reorderIds, seedsFromOrder, sortBySeedEdits } from '../seeding-order';

describe('reorderIds', () => {
  it('moves an entry to the front', () => {
    expect(reorderIds(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B']);
  });

  it('moves an entry down', () => {
    expect(reorderIds(['A', 'B', 'C'], 0, 1)).toEqual(['B', 'A', 'C']);
  });

  it('returns the same reference for a no-op or out-of-range move', () => {
    const ids = ['A', 'B', 'C'];
    expect(reorderIds(ids, 1, 1)).toBe(ids);
    expect(reorderIds(ids, -1, 1)).toBe(ids);
    expect(reorderIds(ids, 0, 3)).toBe(ids);
    expect(reorderIds(ids, 3, 0)).toBe(ids);
  });

  it('does not mutate its input', () => {
    const ids = ['A', 'B', 'C'];
    reorderIds(ids, 2, 0);
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});

describe('seedsFromOrder', () => {
  it('numbers rows 1..n by position, as strings', () => {
    expect(seedsFromOrder(['C', 'A', 'B'])).toEqual({ C: '1', A: '2', B: '3' });
  });
});

describe('Save writes the visible order', () => {
  const seeds = (payload: ReturnType<typeof buildSeedPayload>) =>
    Object.fromEntries(payload.map((e) => [e.player_id, e.seed]));

  it('regression: dragging C to the top renumbers every row', () => {
    const edits = { A: '1', B: '2', C: '3' };
    // Before the change a drag left the typed numbers alone, so Save wrote A=1, B=2, C=3.
    expect(seeds(buildSeedPayload(['C', 'A', 'B'], edits, {}, null))).toEqual({ A: 1, B: 2, C: 3 });

    const order = reorderIds(['A', 'B', 'C'], 2, 0);
    const payload = buildSeedPayload(order, seedsFromOrder(order), {}, null);
    expect(payload.map((e) => [e.player_id, e.seed])).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ]);
  });

  it('seeds a previously unseeded row that is dragged to the top', () => {
    const order = reorderIds(['A', 'B', 'C', 'D'], 3, 0);
    const payload = buildSeedPayload(order, seedsFromOrder(order), {}, null);
    expect(payload.map((e) => [e.player_id, e.seed])).toEqual([
      ['D', 1],
      ['A', 2],
      ['B', 3],
      ['C', 4],
    ]);
  });
});

describe('sortBySeedEdits', () => {
  it('puts a typed 2 before a typed 5', () => {
    expect(sortBySeedEdits(['A', 'B', 'C'], { A: '5', B: '2', C: '9' })).toEqual(['B', 'A', 'C']);
  });

  it('keeps unseeded rows last, in their current relative order', () => {
    expect(sortBySeedEdits(['A', 'B', 'C', 'D'], { A: '', B: '3', C: '  ', D: '1' })).toEqual(['D', 'B', 'A', 'C']);
  });

  it('treats invalid text and values below 1 as unseeded', () => {
    expect(sortBySeedEdits(['A', 'B', 'C'], { A: 'x', B: '0', C: '1' })).toEqual(['C', 'A', 'B']);
  });

  it('keeps ties in their current order', () => {
    expect(sortBySeedEdits(['A', 'B', 'C'], { A: '2', B: '1', C: '2' })).toEqual(['B', 'A', 'C']);
    expect(sortBySeedEdits(['C', 'A', 'B'], { A: '2', B: '1', C: '2' })).toEqual(['B', 'C', 'A']);
  });

  it('treats a row without an edit as unseeded', () => {
    expect(sortBySeedEdits(['A', 'B'], { B: '1' })).toEqual(['B', 'A']);
  });
});

describe('buildSeedPayload', () => {
  it('sends null for empty text and trims before parsing', () => {
    expect(buildSeedPayload(['A', 'B', 'C'], { A: '', B: ' 4 ' }, {}, null)).toEqual([
      { player_id: 'A', seed: null },
      { player_id: 'B', seed: 4 },
      { player_id: 'C', seed: null },
    ]);
  });

  it('includes starting_bracket for double elimination only, defaulting to winners', () => {
    const edits = { A: '1', B: '2' };
    const brackets = { B: 'losers' as const };
    expect(buildSeedPayload(['A', 'B'], edits, brackets, 'double_elim')).toEqual([
      { player_id: 'A', seed: 1, starting_bracket: 'winners' },
      { player_id: 'B', seed: 2, starting_bracket: 'losers' },
    ]);
    for (const type of ['single_elim', 'swiss', 'round_robin', null] as const) {
      expect(buildSeedPayload(['A', 'B'], edits, brackets, type)).toEqual([
        { player_id: 'A', seed: 1 },
        { player_id: 'B', seed: 2 },
      ]);
    }
  });

  it('keeps NaN and 0 detectable for the caller validation', () => {
    const payload = buildSeedPayload(['A', 'B'], { A: 'abc', B: '0' }, {}, null);
    expect(Number.isNaN(payload[0].seed)).toBe(true);
    expect(payload[1].seed).toBe(0);
  });

  it('follows the order it is given', () => {
    expect(buildSeedPayload(['B', 'A'], { A: '1', B: '2' }, {}, null).map((e) => e.player_id)).toEqual(['B', 'A']);
  });
});
