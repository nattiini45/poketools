import { describe, expect, it } from 'vitest';
import {
  bracketStructureInputsFromParticipants,
  buildBracketStructureForParticipants,
  buildDoubleElimStructure,
  buildSingleElimStructure,
  buildSlotIndexMap,
  feederLabel,
} from '../bracket-structure';

describe('buildSingleElimStructure', () => {
  it('creates correct round and slot counts for 8 players', () => {
    const structure = buildSingleElimStructure(8);
    expect(structure.rounds.length).toBe(3);
    expect(structure.slots.length).toBe(7);
    expect(structure.slots.filter((s) => s.bracket_side === 'winners').length).toBe(7);
  });

  it('handles byes for 6 players (bracket size 8)', () => {
    const structure = buildSingleElimStructure(6);
    expect(structure.slots.length).toBe(7);
    const r1 = structure.slots.filter((s) => s.global_round_number === 1);
    expect(r1.length).toBe(4);
    const byeFeeders = r1.flatMap((s) => [s.feeder1, s.feeder2]).filter((f) => f.kind === 'bye');
    expect(byeFeeders.length).toBe(2);
  });
});

describe('buildDoubleElimStructure', () => {
  it('includes winners, losers, and grand final rounds for 8 players', () => {
    const structure = buildDoubleElimStructure(8);
    const sides = new Set(structure.rounds.map((r) => r.bracket_side));
    expect(sides.has('winners')).toBe(true);
    expect(sides.has('losers')).toBe(true);
    expect(sides.has('grand_finals')).toBe(true);
    expect(structure.slots.some((s) => s.bracket_side === 'grand_finals')).toBe(true);
  });

  it('routes losers from WB into LB feeders', () => {
    const structure = buildDoubleElimStructure(8);
    const wbR1 = structure.slots.filter((s) => s.bracket_side === 'winners' && s.side_round_index === 0);
    const lbR1 = structure.slots.filter((s) => s.bracket_side === 'losers' && s.side_round_index === 0);
    expect(wbR1.length).toBe(4);
    expect(lbR1.length).toBe(2);
    expect(lbR1[0].feeder1.kind).toBe('loser');
    expect(lbR1[0].feeder1.slotKey).toBe(wbR1[0].slotKey);
  });

  it('includes GF + reset by default; disabled keeps a single grand final', () => {
    const enabled = buildDoubleElimStructure(16);
    const gfSlots = enabled.slots.filter((s) => s.bracket_side === 'grand_finals');
    expect(gfSlots).toHaveLength(2);
    const gf = gfSlots.find((s) => !s.isBracketReset);
    const reset = gfSlots.find((s) => s.isBracketReset);
    expect(gf).toBeDefined();
    expect(reset).toBeDefined();
    expect(gf!.feeder1.kind).toBe('winner');
    expect(gf!.feeder2.kind).toBe('winner');
    expect(reset!.feeder1).toEqual({ kind: 'winner', slotKey: gf!.slotKey });
    expect(reset!.feeder2).toEqual({ kind: 'loser', slotKey: gf!.slotKey });
    expect(reset!.round_name).toBe('Grand Finals Reset');
    expect(reset!.global_round_number).toBe(gf!.global_round_number);

    const disabled = buildDoubleElimStructure(16, undefined, false);
    expect(disabled.slots.filter((s) => s.bracket_side === 'grand_finals')).toHaveLength(1);
    expect(disabled.slots.some((s) => s.isBracketReset)).toBe(false);
  });

  it('n=2 DE: GF plus conditional reset (winner vs loser of WB Finals)', () => {
    const enabled = buildDoubleElimStructure(2, undefined, true);
    expect(enabled.slots.filter((s) => s.bracket_side === 'grand_finals')).toHaveLength(2);

    const disabled = buildDoubleElimStructure(2, undefined, false);
    const gf = disabled.slots.find((s) => s.bracket_side === 'grand_finals');
    expect(disabled.slots.filter((s) => s.bracket_side === 'grand_finals')).toHaveLength(1);
    expect(disabled.slots.some((s) => s.isBracketReset)).toBe(false);
    const wb = disabled.slots.find((s) => s.bracket_side === 'winners');
    expect(gf?.feeder1).toEqual({ kind: 'winner', slotKey: wb?.slotKey });
    expect(gf?.feeder2).toEqual({ kind: 'loser', slotKey: wb?.slotKey });
  });

  it('threads bracketResetEnabled through buildBracketStructureForParticipants', () => {
    const participants = makeSeededParticipants(8, []);
    const disabled = buildBracketStructureForParticipants('double_elim', participants, {
      bracketResetEnabled: false,
    });
    const enabled = buildBracketStructureForParticipants('double_elim', participants);
    expect(enabled?.slots.some((s) => s.isBracketReset)).toBe(true);
    expect(disabled?.slots.some((s) => s.isBracketReset)).toBe(false);
    expect(disabled).toEqual(buildDoubleElimStructure(8, new Set(), false));
  });
});

describe('feederLabel', () => {
  it('labels winner feeders with match numbers', () => {
    const structure = buildSingleElimStructure(4);
    const indexMap = buildSlotIndexMap(structure.slots);
    const finals = structure.slots.find((s) => s.side_round_index === 1 && s.bracket_side === 'winners');
    expect(finals).toBeDefined();
    if (!finals) return;
    expect(feederLabel(finals.feeder1, indexMap)).toMatch(/^Winner of M/);
  });
});

function loserFeederKeys(structure: ReturnType<typeof buildSingleElimStructure>): string[] {
  return structure.slots.flatMap((slot) =>
    [slot.feeder1, slot.feeder2]
      .filter((f) => f.kind === 'loser' && f.slotKey)
      .map((f) => f.slotKey as string)
  );
}

describe('elimination structure invariants', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])(
    'builds SE for n=%i without throwing',
    (n) => {
      expect(() => buildSingleElimStructure(n)).not.toThrow();
    }
  );

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])(
    'builds DE for n=%i without throwing',
    (n) => {
      expect(() => buildDoubleElimStructure(n)).not.toThrow();
    }
  );

  it('names the SE final round Finals so bo_overrides apply', () => {
    const four = buildSingleElimStructure(4);
    const eight = buildSingleElimStructure(8);
    expect(four.slots.some((s) => s.round_name === 'Finals')).toBe(true);
    expect(four.slots.some((s) => s.round_name === 'Winners Finals')).toBe(false);
    expect(eight.slots.filter((s) => s.round_name === 'Finals')).toHaveLength(1);
  });

  it('keeps Winners Finals naming on DE', () => {
    const structure = buildDoubleElimStructure(4);
    expect(structure.slots.some((s) => s.round_name === 'Winners Finals')).toBe(true);
    expect(structure.slots.some((s) => s.round_name === 'Losers Finals')).toBe(true);
  });

  it.each([4, 8, 16])(
    'has unique loser edges and LB rounds = 2*(wbRounds-1) for n=%i DE',
    (n) => {
      const structure = buildDoubleElimStructure(n);
      const loserKeys = loserFeederKeys(structure);
      expect(new Set(loserKeys).size).toBe(loserKeys.length);

      const wbRounds = structure.rounds.filter((r) => r.bracket_side === 'winners').length;
      const lbRounds = structure.rounds.filter((r) => r.bracket_side === 'losers').length;
      expect(lbRounds).toBe(2 * (wbRounds - 1));

      // Every WB slot feeds exactly one LB slot. The bracket reset adds one
      // loser edge sourced from the GF slot — exclude it here.
      const wbLoserKeys = loserKeys.filter((k) =>
        structure.slots.some((s) => s.slotKey === k && s.bracket_side === 'winners')
      );
      const wbSlots = structure.slots.filter((s) => s.bracket_side === 'winners');
      expect(wbLoserKeys).toHaveLength(wbSlots.length);
      for (const slot of wbSlots) {
        expect(wbLoserKeys).toContain(slot.slotKey);
      }
    }
  );

  it('uses n=2 DE as WB Finals + Grand Finals with loser feeder', () => {
    const structure = buildDoubleElimStructure(2);
    expect(structure.slots.filter((s) => s.bracket_side === 'winners')).toHaveLength(1);
    expect(structure.slots.filter((s) => s.bracket_side === 'losers')).toHaveLength(0);
    const gf = structure.slots.find((s) => s.bracket_side === 'grand_finals');
    const wb = structure.slots.find((s) => s.bracket_side === 'winners');
    expect(gf).toBeDefined();
    expect(wb).toBeDefined();
    expect(gf?.feeder1).toEqual({ kind: 'winner', slotKey: wb?.slotKey });
    expect(gf?.feeder2).toEqual({ kind: 'loser', slotKey: wb?.slotKey });
    expect(structure.rounds.filter((r) => r.bracket_side === 'losers')).toHaveLength(0);
  });

  it('pairs 8-player DE drop-ins in reversed WB order', () => {
    const structure = buildDoubleElimStructure(8);
    const wbSemis = structure.slots.filter(
      (s) => s.bracket_side === 'winners' && s.side_round_index === 1
    );
    const lbDrop = structure.slots.filter(
      (s) => s.bracket_side === 'losers' && s.side_round_index === 1
    );
    expect(wbSemis).toHaveLength(2);
    expect(lbDrop).toHaveLength(2);
    expect(lbDrop[0].feeder2).toEqual({
      kind: 'loser',
      slotKey: wbSemis[1].slotKey,
    });
    expect(lbDrop[1].feeder2).toEqual({
      kind: 'loser',
      slotKey: wbSemis[0].slotKey,
    });
  });

  it('feeds Grand Finals from the last drop-in (Losers Finals), not an extra slot', () => {
    const structure = buildDoubleElimStructure(4);
    const losersFinals = structure.slots.filter((s) => s.round_name === 'Losers Finals');
    expect(losersFinals).toHaveLength(1);
    const gf = structure.slots.find((s) => s.bracket_side === 'grand_finals');
    expect(gf?.feeder2.slotKey).toBe(losersFinals[0].slotKey);
    expect(losersFinals[0].feeder2.kind).toBe('loser');
  });
});

function seedFeeders(structure: ReturnType<typeof buildDoubleElimStructure>, side: 'winners' | 'losers'): number[] {
  return structure.slots
    .filter((slot) => slot.bracket_side === side)
    .flatMap((slot) => [slot.feeder1, slot.feeder2])
    .filter((feeder) => feeder.kind === 'seed' && feeder.seed !== undefined)
    .map((feeder) => feeder.seed as number)
    .sort((a, b) => a - b);
}

function makeSeededParticipants(
  n: number,
  lbPositions: number[]
): Array<{ seed: number; starting_bracket: 'winners' | 'losers'; name: string }> {
  const lb = new Set(lbPositions);
  return Array.from({ length: n }, (_, i) => ({
    seed: i + 1,
    name: `P${i + 1}`,
    starting_bracket: lb.has(i + 1) ? 'losers' : 'winners',
  }));
}

function assertWbLoserInvariant(structure: ReturnType<typeof buildDoubleElimStructure>): void {
  const loserKeys = loserFeederKeys(structure);
  expect(new Set(loserKeys).size).toBe(loserKeys.length);
  // Every real (non-bye) WB slot feeds exactly one LB slot.
  const realWbSlots = structure.slots.filter(
    (s) =>
      s.bracket_side === 'winners' &&
      s.feeder1.kind !== 'bye' &&
      s.feeder2.kind !== 'bye'
  );
  const wbLoserKeys = loserKeys.filter((k) =>
    structure.slots.some((s) => s.slotKey === k && s.bracket_side === 'winners')
  );
  expect(wbLoserKeys).toHaveLength(realWbSlots.length);
  for (const slot of realWbSlots) {
    expect(wbLoserKeys).toContain(slot.slotKey);
  }

  // Grand Finals + bracket reset ("if necessary").
  const gfSlots = structure.slots.filter((s) => s.bracket_side === 'grand_finals');
  expect(gfSlots).toHaveLength(2);
  const gf = gfSlots.find((s) => !s.isBracketReset);
  const reset = gfSlots.find((s) => s.isBracketReset);
  expect(gf).toBeDefined();
  expect(reset).toBeDefined();
  expect(reset!.feeder1).toEqual({ kind: 'winner', slotKey: gf!.slotKey });
  expect(reset!.feeder2).toEqual({ kind: 'loser', slotKey: gf!.slotKey });
}

describe('double-elim losers-bracket starts', () => {
  it('leaves single-elim unchanged when participants have starting_bracket', () => {
    const participants = makeSeededParticipants(8, [7, 8]);
    expect(buildBracketStructureForParticipants('single_elim', participants)).toEqual(
      buildSingleElimStructure(8)
    );
  });

  it('derives LB starter positions from seed order', () => {
    const inputs = bracketStructureInputsFromParticipants(makeSeededParticipants(8, [7, 8]));
    expect(inputs.participantCount).toBe(8);
    expect([...inputs.lbStarterSeeds].sort((a, b) => a - b)).toEqual([7, 8]);
  });

  it('matches the helper graph for 8 players with 2 LB starters', () => {
    const participants = makeSeededParticipants(8, [7, 8]);
    const viaHelper = buildBracketStructureForParticipants('double_elim', participants);
    const viaDirect = buildDoubleElimStructure(8, new Set([7, 8]));
    expect(viaHelper).toEqual(viaDirect);
  });

  it('places 2 LB starters on losers-side seed feeders (8 players)', () => {
    const structure = buildDoubleElimStructure(8, new Set([7, 8]));
    expect(seedFeeders(structure, 'winners')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seedFeeders(structure, 'losers')).toEqual([7, 8]);
    assertWbLoserInvariant(structure);
  });

  it('pairs LB starters among themselves in LB R1 and drops WB R1 losers into LB R2', () => {
    const structure = buildDoubleElimStructure(8, new Set([5, 6, 7, 8]));
    expect(seedFeeders(structure, 'winners')).toEqual([1, 2, 3, 4]);
    expect(seedFeeders(structure, 'losers')).toEqual([5, 6, 7, 8]);

    const lbR1 = structure.slots.filter(
      (s) => s.bracket_side === 'losers' && s.side_round_index === 0
    );
    expect(lbR1).toHaveLength(2);
    for (const slot of lbR1) {
      expect(slot.feeder1.kind).toBe('seed');
      expect(slot.feeder2.kind).toBe('seed');
    }

    const lbR2 = structure.slots.filter(
      (s) => s.bracket_side === 'losers' && s.side_round_index === 1
    );
    expect(lbR2.length).toBeGreaterThan(0);
    const lbR2HasLoserFeeder = lbR2.some((slot) =>
      [slot.feeder1, slot.feeder2].some((f) => f.kind === 'loser')
    );
    expect(lbR2HasLoserFeeder).toBe(true);
    assertWbLoserInvariant(structure);
  });

  it('handles a 5 WB + 3 LB odd split', () => {
    const structure = buildDoubleElimStructure(8, new Set([6, 7, 8]));
    expect(seedFeeders(structure, 'winners')).toEqual([1, 2, 3, 4, 5]);
    expect(seedFeeders(structure, 'losers')).toEqual([6, 7, 8]);
    const lbR1 = structure.slots.filter(
      (s) => s.bracket_side === 'losers' && s.side_round_index === 0
    );
    const byeFeeders = lbR1.flatMap((s) => [s.feeder1, s.feeder2]).filter((f) => f.kind === 'bye');
    expect(byeFeeders.length).toBeGreaterThanOrEqual(1);
    assertWbLoserInvariant(structure);
  });

  it('gives an LB starter a bye when the entry cohort is odd', () => {
    const structure = buildDoubleElimStructure(6, new Set([4, 5, 6]));
    expect(seedFeeders(structure, 'winners')).toEqual([1, 2, 3]);
    expect(seedFeeders(structure, 'losers')).toEqual([4, 5, 6]);
    const lbR1 = structure.slots.filter(
      (s) => s.bracket_side === 'losers' && s.side_round_index === 0
    );
    const hasSeedVsBye = lbR1.some((slot) => {
      const feeders = [slot.feeder1, slot.feeder2];
      return feeders.some((f) => f.kind === 'seed') && feeders.some((f) => f.kind === 'bye');
    });
    expect(hasSeedVsBye).toBe(true);
    assertWbLoserInvariant(structure);
  });

  it('builds n=2 with one LB starter as WB bye + LB seed + Grand Finals', () => {
    const structure = buildDoubleElimStructure(2, new Set([2]));
    const wb = structure.slots.filter((s) => s.bracket_side === 'winners');
    const lb = structure.slots.filter((s) => s.bracket_side === 'losers');
    const gf = structure.slots.find((s) => s.bracket_side === 'grand_finals');
    expect(wb).toHaveLength(1);
    expect(wb[0].feeder1).toEqual({ kind: 'seed', seed: 1 });
    expect(wb[0].feeder2.kind).toBe('bye');
    expect(seedFeeders(structure, 'losers')).toEqual([2]);
    expect(gf?.feeder1).toEqual({ kind: 'winner', slotKey: wb[0].slotKey });
    expect(gf?.feeder2.kind).toBe('winner');
    expect(gf?.feeder2.slotKey).toBe(lb[lb.length - 1]?.slotKey);
    assertWbLoserInvariant(structure);
  });

  it('falls back to the standard graph when every participant starts in losers', () => {
    expect(buildDoubleElimStructure(8, new Set([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual(
      buildDoubleElimStructure(8)
    );
  });

  it('labels losers-side seed feeders as LB starts', () => {
    const structure = buildDoubleElimStructure(8, new Set([7, 8]));
    const indexMap = buildSlotIndexMap(structure.slots);
    const lbSeed = structure.slots
      .filter((s) => s.bracket_side === 'losers')
      .flatMap((s) => [s.feeder1, s.feeder2])
      .find((f) => f.kind === 'seed');
    expect(lbSeed).toBeDefined();
    expect(feederLabel(lbSeed!, indexMap, { onLosersSide: true })).toMatch(/\(LB\)/);
  });

  it('adds a conditional bracket reset in the Grand Finals round', () => {
    const structure = buildDoubleElimStructure(8, new Set([5, 6, 7, 8]));
    const gfSlots = structure.slots.filter((s) => s.bracket_side === 'grand_finals');
    expect(gfSlots).toHaveLength(2);

    const gf = gfSlots.find((s) => !s.isBracketReset);
    const reset = gfSlots.find((s) => s.isBracketReset);
    expect(gf).toBeDefined();
    expect(reset).toBeDefined();
    expect(reset!.feeder1).toEqual({ kind: 'winner', slotKey: gf!.slotKey });
    expect(reset!.feeder2).toEqual({ kind: 'loser', slotKey: gf!.slotKey });
    expect(reset!.global_round_number).toBe(gf!.global_round_number);
    expect(gf!.bracket_pos).toBe(0);
    expect(reset!.bracket_pos).toBe(1);
  });
});
