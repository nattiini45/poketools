import { describe, expect, it } from 'vitest';
import {
  CROSS_MATCHES_PER_HALF,
  GroupScheduleError,
  firstHalfLastWeek,
  pairKey,
  pairPlacementWeek,
  planGroupSchedule,
  weekPairings,
  type GroupSchedulePlan,
  type ScheduleGroup,
} from '../group-schedule';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '../round-robin';
import type { Pairing } from '../types';

/** Groups A, B, C, … of the given sizes; members A1..An in seed order. */
function groupsOf(...sizes: number[]): ScheduleGroup[] {
  return sizes.map((size, g) => ({
    id: `group-${String.fromCharCode(65 + g)}`,
    memberIds: Array.from({ length: size }, (_, i) => `${String.fromCharCode(65 + g)}${i + 1}`),
  }));
}

const key = (p: Pairing) => [p.player_1_id, p.player_2_id].sort().join('-');

/** The plan with every placement week paired from the seed order (the tables before any result). */
function fullPairings(groups: ScheduleGroup[], plan: GroupSchedulePlan): Map<number, Pairing[]> {
  const byWeek = new Map<number, Pairing[]>();
  for (const week of plan.weeks) {
    byWeek.set(
      week.week,
      week.awaitingTables
        ? [...week.groupPairings, ...pairPlacementWeek(groups.map((g) => [...g.memberIds]))]
        : weekPairings(week),
    );
  }
  return byWeek;
}

function groupIndexOf(groups: ScheduleGroup[]): Map<string, number> {
  const out = new Map<string, number>();
  groups.forEach((g, i) => g.memberIds.forEach((id) => out.set(id, i)));
  return out;
}

/** Cross-group matches per trainer per half ([half 1, half 2]). */
function crossPerHalf(groups: ScheduleGroup[], plan: GroupSchedulePlan): Map<string, [number, number]> {
  const groupOf = groupIndexOf(groups);
  const pairings = fullPairings(groups, plan);
  const counts = new Map<string, [number, number]>();
  for (const id of groupOf.keys()) counts.set(id, [0, 0]);
  for (const week of plan.weeks) {
    for (const p of pairings.get(week.week)!) {
      if (groupOf.get(p.player_1_id) === groupOf.get(p.player_2_id)) continue;
      counts.get(p.player_1_id)![week.half - 1] += 1;
      counts.get(p.player_2_id)![week.half - 1] += 1;
    }
  }
  return counts;
}

/** Invariants every cross plan must hold. */
function expectValidCrossPlan(groups: ScheduleGroup[], plan: GroupSchedulePlan): void {
  const groupOf = groupIndexOf(groups);
  const pairings = fullPairings(groups, plan);

  // Weeks are 1..N, in order; the first half is exactly the Hinrunde (floor(N / 2) weeks).
  expect(plan.weeks.map((w) => w.week)).toEqual(Array.from({ length: plan.totalWeeks }, (_, i) => i + 1));
  expect(plan.firstHalfLastWeek).toBe(Math.floor(plan.totalWeeks / 2));
  expect(plan.weeks.filter((w) => w.half === 1).length).toBe(plan.firstHalfLastWeek);
  // Each half ends with its placement week, and only there.
  const placements = plan.weeks.filter((w) => w.kind === 'placement').map((w) => w.week);
  expect(placements).toEqual([plan.firstHalfLastWeek, plan.totalWeeks]);

  // No trainer plays twice in a week; nobody plays themselves.
  for (const [week, list] of pairings) {
    const seen = new Set<string>();
    for (const p of list) {
      expect(p.player_1_id).not.toBe(p.player_2_id);
      for (const id of [p.player_1_id, p.player_2_id]) {
        expect(seen.has(id), `${id} twice in week ${week}`).toBe(false);
        seen.add(id);
      }
    }
  }

  // In-group pairings: each group's full single round robin, every pairing exactly once, each round in order.
  for (const [g, group] of groups.entries()) {
    const expected = Array.from({ length: getRoundRobinTotalRounds(group.memberIds.length) }, (_, i) =>
      generateRoundRobinRound([...group.memberIds], i + 1).pairings.map(key),
    );
    const played = plan.weeks
      .filter((w) => w.groupRounds[group.id] !== null)
      .map((w) => w.groupPairings.filter((p) => groupOf.get(p.player_1_id) === g).map(key));
    expect(played).toEqual(expected);
  }

  // Cross pairings are always across groups; in-group pairings always inside one.
  for (const week of plan.weeks) {
    for (const p of week.crossPairings) expect(groupOf.get(p.player_1_id)).not.toBe(groupOf.get(p.player_2_id));
    for (const p of week.groupPairings) expect(groupOf.get(p.player_1_id)).toBe(groupOf.get(p.player_2_id));
  }
}

describe('planGroupSchedule — cross-group play (league groups)', () => {
  it('7+7: one bye pairing per in-group week, a dedicated week for the rest, every trainer 2 per half', () => {
    const groups = groupsOf(7, 7);
    const plan = planGroupSchedule(groups, { crossGroup: true });
    expectValidCrossPlan(groups, plan);
    expect(plan.totalWeeks).toBe(11);
    expect(plan.firstHalfLastWeek).toBe(5);
    expect(plan.weeks.map((w) => w.kind)).toEqual([
      'group', 'group', 'group', 'cross', 'placement',
      'group', 'group', 'group', 'group', 'cross', 'placement',
    ]);
    // Rule 1: the two byes of every in-group week meet across groups.
    for (const week of plan.weeks.filter((w) => w.kind === 'group')) expect(week.crossPairings).toHaveLength(1);
    for (const counts of crossPerHalf(groups, plan).values()) {
      expect(counts).toEqual([CROSS_MATCHES_PER_HALF, CROSS_MATCHES_PER_HALF]);
    }
    // The history's group table length: 6 in-group + 4 cross matches over the phase's single round robin.
    const matches = new Map<string, number>();
    for (const list of fullPairings(groups, plan).values()) {
      for (const p of list) for (const id of [p.player_1_id, p.player_2_id]) matches.set(id, (matches.get(id) ?? 0) + 1);
    }
    for (const count of matches.values()) expect(count).toBe(6 + 4);
  });

  it('6+6: no byes, so each half gets one dedicated cross week paired by mirrored seeds', () => {
    const groups = groupsOf(6, 6);
    const plan = planGroupSchedule(groups, { crossGroup: true });
    expectValidCrossPlan(groups, plan);
    expect(plan.totalWeeks).toBe(9);
    expect(plan.firstHalfLastWeek).toBe(4);
    const cross = plan.weeks.filter((w) => w.kind === 'cross');
    expect(cross).toHaveLength(2);
    // Mirrored seeds: seed 1 against the other group's seed 6, and so on.
    expect(cross[0].crossPairings.map(key).sort()).toEqual(
      ['A1-B6', 'A2-B5', 'A3-B4', 'A4-B3', 'A5-B2', 'A6-B1'].sort(),
    );
    // In-group weeks carry no cross match (nobody is free).
    for (const week of plan.weeks.filter((w) => w.kind === 'group')) expect(week.crossPairings).toEqual([]);
    for (const counts of crossPerHalf(groups, plan).values()) expect(counts).toEqual([2, 2]);
  });

  it('7+6: each group its own round count, the smaller group rests, nothing throws', () => {
    const groups = groupsOf(7, 6);
    const plan = planGroupSchedule(groups, { crossGroup: true });
    expectValidCrossPlan(groups, plan);
    expect(plan.totalWeeks).toBe(11);
    // The 6-group has 5 in-group rounds and rests in the 7-group's 6th and 7th round weeks; its free trainers
    // meet the 7-group's bye there.
    const restWeeks = plan.weeks.filter((w) => w.kind === 'group' && w.groupRounds['group-B'] === null);
    expect(restWeeks.map((w) => w.groupRounds['group-A'])).toEqual([6, 7]);
    for (const week of restWeeks) expect(week.crossPairings).toHaveLength(1);
    // 13 trainers: one trainer per half cannot get the regular cross match (odd total); everyone else does.
    const counts = [...crossPerHalf(groups, plan).values()];
    expect(counts.filter(([h1]) => h1 < 2)).toHaveLength(1);
    expect(counts.filter(([, h2]) => h2 < 2)).toHaveLength(1);
    // The trainer left out in the first half is served first in the second (priority by cross matches so far).
    const short1 = [...crossPerHalf(groups, plan).entries()].find(([, [h1]]) => h1 < 2)![0];
    expect(crossPerHalf(groups, plan).get(short1)![1]).toBeGreaterThanOrEqual(1);
  });

  it('5+5: byes cover part of each half, a dedicated week the rest', () => {
    const groups = groupsOf(5, 5);
    const plan = planGroupSchedule(groups, { crossGroup: true });
    expectValidCrossPlan(groups, plan);
    expect(plan.totalWeeks).toBe(9);
    for (const counts of crossPerHalf(groups, plan).values()) expect(counts).toEqual([2, 2]);
  });

  it('4+4+4: three groups, cross weeks pair every trainer across groups, placement rotates the groups', () => {
    const groups = groupsOf(4, 4, 4);
    const plan = planGroupSchedule(groups, { crossGroup: true });
    expectValidCrossPlan(groups, plan);
    expect(plan.totalWeeks).toBe(7);
    expect(plan.firstHalfLastWeek).toBe(3);
    for (const counts of crossPerHalf(groups, plan).values()) expect(counts).toEqual([2, 2]);
    const cross = plan.weeks.filter((w) => w.kind === 'cross');
    for (const week of cross) expect(week.crossPairings).toHaveLength(6);
  });

  it('a single group is a no-op: the plain round robin, no cross weeks', () => {
    const groups = groupsOf(7);
    const plan = planGroupSchedule(groups, { crossGroup: true });
    expect(plan.crossGroup).toBe(false);
    expect(plan.totalWeeks).toBe(7);
    plan.weeks.forEach((week, i) => {
      expect(week.kind).toBe('group');
      expect(week.crossPairings).toEqual([]);
      expect(week.groupPairings).toEqual(generateRoundRobinRound([...groups[0].memberIds], i + 1).pairings);
    });
  });

  it('is deterministic: the same groups always give the same plan', () => {
    const a = planGroupSchedule(groupsOf(7, 7), { crossGroup: true });
    const b = planGroupSchedule(groupsOf(7, 7), { crossGroup: true });
    expect(a).toEqual(b);
  });

  it('balances the halves for every layout of 2-4 groups of 2-10 trainers', () => {
    for (const sizes of [
      [2, 2], [3, 3], [2, 5], [8, 8], [9, 9], [10, 10], [10, 9], [8, 3],
      [3, 3, 3], [5, 5, 5], [6, 6, 7], [2, 3, 4], [4, 4, 4, 4], [7, 7, 7, 7], [2, 10, 10, 10],
    ]) {
      const groups = groupsOf(...sizes);
      const plan = planGroupSchedule(groups, { crossGroup: true });
      expectValidCrossPlan(groups, plan);
    }
  });

  it('known limit: unequal groups are valid but only approximately balanced (resting groups play more cross matches)', () => {
    const range = (groups: ScheduleGroup[], plan: GroupSchedulePlan, half: 0 | 1) => {
      const values = [...crossPerHalf(groups, plan).values()].map((counts) => counts[half]);
      return [Math.min(...values), Math.max(...values)];
    };
    const ranges: Record<string, number[][]> = {};
    for (const sizes of [[7, 7], [7, 6], [2, 3, 4, 5, 6, 7], [7, 6, 6, 6, 6, 6]]) {
      const groups = groupsOf(...sizes);
      const plan = planGroupSchedule(groups, { crossGroup: true });
      expectValidCrossPlan(groups, plan);
      ranges[sizes.join('+')] = [range(groups, plan, 0), range(groups, plan, 1)];
    }
    // Equal groups: exactly the target (placement match included) in each half.
    expect(ranges['7+7']).toEqual([
      [CROSS_MATCHES_PER_HALF, CROSS_MATCHES_PER_HALF],
      [CROSS_MATCHES_PER_HALF, CROSS_MATCHES_PER_HALF],
    ]);
    // Unequal groups: the spread docs/season.md and spec 6.4a disclose.
    expect(ranges).toMatchInlineSnapshot(`
      {
        "2+3+4+5+6+7": [
          [
            1,
            3,
          ],
          [
            0,
            5,
          ],
        ],
        "7+6": [
          [
            0,
            2,
          ],
          [
            1,
            3,
          ],
        ],
        "7+6+6+6+6+6": [
          [
            1,
            2,
          ],
          [
            0,
            3,
          ],
        ],
        "7+7": [
          [
            2,
            2,
          ],
          [
            2,
            2,
          ],
        ],
      }
    `);
  });

  it('known limit: a dedicated cross week can hold a single match (exactly two trainers short)', () => {
    const plan = planGroupSchedule(groupsOf(3, 3), { crossGroup: true });
    const single = plan.weeks.filter((w) => w.kind === 'cross' && w.crossPairings.length === 1).map((w) => w.week);
    expect(single).toEqual([6]);
  });

  it('leaves the placement weeks open until their pairings are given, and uses given ones', () => {
    const groups = groupsOf(6, 6);
    const open = planGroupSchedule(groups, { crossGroup: true });
    const placement = open.weeks.find((w) => w.kind === 'placement')!;
    expect(placement.awaitingTables).toBe(true);
    expect(placement.crossPairings).toEqual([]);

    const given: Pairing[] = [{ player_1_id: 'A1', player_2_id: 'B2' }, { player_1_id: 'A2', player_2_id: 'B1' }];
    const filled = planGroupSchedule(groups, {
      crossGroup: true,
      placementPairings: new Map([[placement.week, given]]),
    });
    const week = filled.weeks.find((w) => w.week === placement.week)!;
    expect(week.awaitingTables).toBe(false);
    expect(week.crossPairings).toEqual(given);
    // Weeks before the placement week never change.
    expect(filled.weeks.slice(0, placement.week - 1)).toEqual(open.weeks.slice(0, placement.week - 1));
    // The structure (week count, kinds) never depends on the placement results.
    expect(filled.weeks.map((w) => w.kind)).toEqual(open.weeks.map((w) => w.kind));
  });
});

describe('planGroupSchedule — without cross-group play', () => {
  it('equal phase-only groups keep the old schedule: week w = every group round w', () => {
    const groups = groupsOf(4, 4);
    const plan = planGroupSchedule(groups, { crossGroup: false });
    expect(plan.totalWeeks).toBe(3);
    plan.weeks.forEach((week, i) => {
      expect(week.groupPairings).toEqual([
        ...generateRoundRobinRound([...groups[0].memberIds], i + 1).pairings,
        ...generateRoundRobinRound([...groups[1].memberIds], i + 1).pairings,
      ]);
      expect(week.crossPairings).toEqual([]);
    });
  });

  it('unequal phase-only groups: the smaller group rests instead of throwing', () => {
    const groups = groupsOf(7, 6);
    const plan = planGroupSchedule(groups, { crossGroup: false });
    expect(plan.totalWeeks).toBe(7);
    expect(plan.weeks.map((w) => w.groupRounds['group-B'])).toEqual([1, 2, 3, 4, 5, null, null]);
    expect(plan.weeks.every((w) => w.crossPairings.length === 0)).toBe(true);
  });

  it('refuses a layout that cannot be scheduled', () => {
    expect(() => planGroupSchedule([], { crossGroup: true })).toThrow(GroupScheduleError);
    expect(() => planGroupSchedule([{ id: 'g', memberIds: [] }], { crossGroup: false })).toThrow(
      expect.objectContaining({ code: 'group_empty' }),
    );
    expect(() =>
      planGroupSchedule(
        [
          { id: 'a', memberIds: ['p1', 'p2'] },
          { id: 'b', memberIds: ['p2', 'p3'] },
        ],
        { crossGroup: true },
      ),
    ).toThrow(expect.objectContaining({ code: 'player_in_several_groups' }));
  });
});

describe('pairPlacementWeek', () => {
  it('two equal groups: every place meets the same place of the other group', () => {
    expect(pairPlacementWeek([['A1', 'A2', 'A3'], ['B1', 'B2', 'B3']]).map(key)).toEqual(['A1-B1', 'A2-B2', 'A3-B3']);
  });

  it('follows the table order, not the seeds', () => {
    expect(pairPlacementWeek([['A3', 'A1', 'A2'], ['B2', 'B3', 'B1']]).map(key)).toEqual(['A3-B2', 'A1-B3', 'A2-B1']);
  });

  it('the extra trainer of a larger group rests', () => {
    const pairs = pairPlacementWeek([['A1', 'A2', 'A3'], ['B1', 'B2']]);
    expect(pairs.map(key)).toEqual(['A1-B1', 'A2-B2']);
  });

  it('three groups: the trainer left at a place meets the next place of another group', () => {
    const pairs = pairPlacementWeek([
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ]);
    expect(pairs.map(key)).toEqual(['A1-B1', 'B2-C1', 'A2-C2']);
    expect(firstHalfLastWeek(7)).toBe(3);
  });

  it('three groups: a trainer prefers a same-placed trainer it has not met yet (rematch only when unavoidable)', () => {
    const tables = [
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ];
    const pairs = pairPlacementWeek(tables, new Set([pairKey('A1', 'B1')]));
    expect(pairs.map(key)).toEqual(['A1-C1', 'B1-C2', 'A2-B2']);
    expect(pairs.some((p) => key(p) === 'A1-B1')).toBe(false);
    // Every candidate met already: the same-placed rule still pairs them (a rematch).
    const allMet = new Set([pairKey('A1', 'B1'), pairKey('A1', 'C1')]);
    expect(pairPlacementWeek(tables, allMet).map(key)[0]).toBe('A1-B1');
  });

  it('two groups: one candidate per place, so the same-placed rule wins over avoiding a rematch', () => {
    const met = new Set([pairKey('A1', 'B1')]);
    expect(pairPlacementWeek([['A1', 'A2'], ['B1', 'B2']], met).map(key)).toEqual(['A1-B1', 'A2-B2']);
  });
});

describe('GroupScheduleError codes', () => {
  it('no_balance is a coded refusal, so the caller maps it (never a generic 500)', () => {
    const err = new GroupScheduleError('no_balance', 'no split balances the halves');
    expect(err).toBeInstanceOf(GroupScheduleError);
    expect(err.code).toBe('no_balance');
  });
});
