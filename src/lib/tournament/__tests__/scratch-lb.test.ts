import { describe, it, expect } from 'vitest';
import {
  buildBracketStructureForParticipants,
  type BracketStructureParticipant,
} from '../bracket-structure';

function participants(n: number, lb: number[]): BracketStructureParticipant[] {
  const set = new Set(lb);
  return Array.from({ length: n }, (_, i) => ({
    seed: i + 1,
    name: `P${i + 1}`,
    starting_bracket: set.has(i + 1) ? 'losers' : 'winners',
  }));
}

describe('scratch LB', () => {
  it('shows LB starters for 8 players seeds 7,8', () => {
    const s = buildBracketStructureForParticipants('double_elim', participants(8, [7, 8]))!;
    console.log('ROUNDS:', JSON.stringify(s.rounds, null, 0));
    for (const slot of s.slots) {
      console.log(
        slot.round_name,
        slot.bracket_side,
        'r' + slot.global_round_number,
        slot.slotKey,
        JSON.stringify(slot.feeder1),
        JSON.stringify(slot.feeder2)
      );
    }
    const lbSeedFeeders = s.slots
      .filter((x) => x.bracket_side === 'losers')
      .flatMap((x) => [x.feeder1, x.feeder2])
      .filter((f) => f.kind === 'seed');
    expect(lbSeedFeeders.map((f) => f.seed).sort()).toEqual([7, 8]);
  });

  it('shows LB starter for 8 players seed 8 only', () => {
    const s = buildBracketStructureForParticipants('double_elim', participants(8, [8]))!;
    const lbSeedFeeders = s.slots
      .filter((x) => x.bracket_side === 'losers')
      .flatMap((x) => [x.feeder1, x.feeder2])
      .filter((f) => f.kind === 'seed');
    expect(lbSeedFeeders.map((f) => f.seed)).toEqual([8]);
  });
});
