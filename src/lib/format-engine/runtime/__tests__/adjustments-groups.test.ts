import { describe, expect, it } from 'vitest';
import { standingAdjustments, type AdjustmentRow } from '../adjustments';

const points = (stage: string, player: string, delta: number): AdjustmentRow => ({
  kind: 'points',
  target: { stage, player_id: player },
  delta: { points: delta },
});
const order = (stage: string, ids: string[]): AdjustmentRow => ({ kind: 'rank', target: { stage }, delta: { order: ids } });

describe('standingAdjustments', () => {
  it('maps a stage to its one phase', () => {
    const rows = [points('cup', 'a', 2), points('cup', 'a', 1), order('cup', ['b', 'a'])];
    const result = standingAdjustments(rows, new Map([['cup', 'ph1']]));
    expect(result.adjustments).toEqual({ ph1: { a: 3 } });
    expect(result.manualOrder).toEqual({ ph1: ['b', 'a'] });
  });

  it('drops a row of a stage the league has not', () => {
    expect(standingAdjustments([points('nope', 'a', 1)], new Map([['cup', 'ph1']]))).toEqual({ adjustments: {}, manualOrder: {} });
  });

  describe('a foreach_group stage with one phase per group', () => {
    const phases = new Map([['finals', ['g1', 'g2']]]);
    const members = new Map([
      ['g1', new Set(['a', 'b'])],
      ['g2', new Set(['c', 'd'])],
    ]);

    it('puts a points row into the phase of the player, in every group', () => {
      const rows = [points('finals', 'a', 2), points('finals', 'd', 5)];
      expect(standingAdjustments(rows, phases, members).adjustments).toEqual({ g1: { a: 2 }, g2: { d: 5 } });
    });

    it('does not count one adjustment once per phase', () => {
      const total = Object.values(standingAdjustments([points('finals', 'c', 4)], phases, members).adjustments)
        .flatMap((byPlayer) => Object.values(byPlayer))
        .reduce((sum, n) => sum + n, 0);
      expect(total).toBe(4);
    });

    it("applies the admin's order to every group phase", () => {
      const result = standingAdjustments([order('finals', ['d', 'a', 'c', 'b'])], phases, members);
      expect(result.manualOrder).toEqual({ g1: ['d', 'a', 'c', 'b'], g2: ['d', 'a', 'c', 'b'] });
    });

    it('drops the points of a player no phase lists', () => {
      expect(standingAdjustments([points('finals', 'ghost', 1)], phases, members).adjustments).toEqual({});
    });
  });
});
