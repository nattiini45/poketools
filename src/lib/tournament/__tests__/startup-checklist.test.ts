import { describe, expect, it } from 'vitest';
import {
  MIN_PARTICIPANTS,
  buildStartupChecklist,
  nextRoundToStart,
  participantsSectionOpen,
  roundRobinProgress,
  type StartupChecklistInput,
  type StartupItem,
  type StartupItemId,
} from '../startup-checklist';
import type { RoundStatus } from '@/types/round';

type RoundRow = StartupChecklistInput['rounds'][number];

function round(
  number: number,
  status: RoundStatus = 'completed',
  bracketSide: RoundRow['bracket_side'] = null,
): RoundRow {
  return { name: `Round ${number}`, round_number: number, status, bracket_side: bracketSide };
}

/** `count` participants of whom the first `seeded` are seeded. */
function field(count: number, seeded = count) {
  return {
    count,
    seededCount: seeded,
    playerIds: Array.from({ length: count }, (_, i) => `p${i + 1}`),
  };
}

function input(overrides: Partial<StartupChecklistInput> = {}): StartupChecklistInput {
  return {
    bracketType: 'swiss',
    tournamentStatus: 'upcoming',
    rulesetSet: true,
    rulesetName: 'Standard',
    bestOfDefault: 3,
    participants: field(8),
    rounds: [],
    groupsInUse: false,
    leagueGroupOf: null,
    ...overrides,
  };
}

function item(items: StartupItem[], id: StartupItemId): StartupItem | undefined {
  return items.find((entry) => entry.id === id);
}

describe('buildStartupChecklist — setup (no rounds yet)', () => {
  it('requires at least 2 participants', () => {
    expect(MIN_PARTICIPANTS).toBe(2);

    for (const [count, state, blocked] of [
      [0, 'blocked', true],
      [1, 'blocked', true],
      [2, 'done', false],
      [8, 'done', false],
    ] as const) {
      const checklist = buildStartupChecklist(input({ participants: field(count) }));
      const participants = item(checklist.items, 'participants');
      expect(participants?.state, `${count} participants`).toBe(state);
      expect(participants?.params).toEqual({ count, min: 2 });
      expect(participants?.link).toBe('participants');
      expect(checklist.blocked, `${count} participants`).toBe(blocked);
    }
  });

  it('treats an unknown participant list as unknown, never as blocked', () => {
    const checklist = buildStartupChecklist(input({ participants: null }));

    const participants = item(checklist.items, 'participants');
    expect(participants?.state).toBe('unknown');
    expect(participants?.params).toEqual({ min: 2 });
    expect(checklist.blocked).toBe(false);
    // Rows that need the list stay out until it is known.
    expect(item(checklist.items, 'seeding')).toBeUndefined();
    expect(item(checklist.items, 'groups')).toBeUndefined();
  });

  it('lists the setup items in order', () => {
    const checklist = buildStartupChecklist(
      input({ leagueGroupOf: Object.fromEntries(field(8).playerIds.map((id) => [id, 'g1'])) }),
    );

    expect(checklist.items.map((entry) => entry.id)).toEqual([
      'participants',
      'ruleset',
      'bestOf',
      'groups',
      'seeding',
    ]);
    expect(checklist.blocked).toBe(false);
  });

  it('blocks on a missing ruleset and links to the overview', () => {
    const checklist = buildStartupChecklist(input({ rulesetSet: false, rulesetName: null }));

    const ruleset = item(checklist.items, 'ruleset');
    expect(ruleset?.state).toBe('blocked');
    expect(ruleset?.link).toBe('overview');
    expect(checklist.blocked).toBe(true);
  });

  it('carries the ruleset name when there is one', () => {
    const named = item(buildStartupChecklist(input()).items, 'ruleset');
    expect(named).toMatchObject({ state: 'done', params: { name: 'Standard' } });

    const unnamed = item(buildStartupChecklist(input({ rulesetName: null })).items, 'ruleset');
    expect(unnamed).toMatchObject({ state: 'done', params: {} });
  });

  it('blocks on a best-of that is not a positive whole number', () => {
    expect(item(buildStartupChecklist(input()).items, 'bestOf')).toMatchObject({
      state: 'done',
      params: { count: 3, bestOf: 3 },
      link: 'overview',
    });
    for (const bestOfDefault of [0, -1, 2.5, Number.NaN]) {
      const checklist = buildStartupChecklist(input({ bestOfDefault }));
      expect(item(checklist.items, 'bestOf')?.state, String(bestOfDefault)).toBe('blocked');
      expect(checklist.blocked).toBe(true);
    }
  });

  it('flags participants missing from the league group map', () => {
    const players = field(8).playerIds;
    const missingThree = Object.fromEntries(players.slice(0, 5).map((id) => [id, 'g1']));

    const blocked = buildStartupChecklist(input({ leagueGroupOf: missingThree }));
    expect(item(blocked.items, 'groups')).toMatchObject({
      state: 'blocked',
      params: { count: 3 },
      link: 'leagueGroups',
    });
    expect(blocked.blocked).toBe(true);

    const full = buildStartupChecklist(input({ leagueGroupOf: Object.fromEntries(players.map((id) => [id, 'g1'])) }));
    expect(item(full.items, 'groups')).toMatchObject({ state: 'done', params: { count: 0 } });
    expect(full.blocked).toBe(false);
  });

  it('shows no groups row for a phase that does not mirror league groups', () => {
    expect(item(buildStartupChecklist(input({ leagueGroupOf: null })).items, 'groups')).toBeUndefined();
  });

  it('asks for attention (never blocks) while some participants are unseeded', () => {
    const partly = buildStartupChecklist(input({ participants: field(8, 5) }));

    expect(item(partly.items, 'seeding')).toMatchObject({
      state: 'attention',
      params: { unseeded: 3 },
      link: 'participants',
    });
    expect(partly.blocked).toBe(false);

    expect(item(buildStartupChecklist(input({ participants: field(8, 8) })).items, 'seeding')?.state).toBe('done');
  });

  it('shows no seeding row below the minimum field', () => {
    expect(item(buildStartupChecklist(input({ participants: field(1, 0) })).items, 'seeding')).toBeUndefined();
  });

  it('shows the setup items only while there are no rounds', () => {
    const checklist = buildStartupChecklist(input({ rounds: [round(1)], participants: field(8, 2) }));

    for (const id of ['participants', 'ruleset', 'bestOf', 'groups', 'seeding'] as const) {
      expect(item(checklist.items, id), id).toBeUndefined();
    }
  });
});

describe('buildStartupChecklist — next round', () => {
  it('blocks Swiss while the last round is not completed', () => {
    for (const status of ['active', 'pending'] as const) {
      const checklist = buildStartupChecklist(input({ rounds: [round(1), round(2, status)] }));

      expect(item(checklist.items, 'previousRound')).toMatchObject({
        state: 'blocked',
        params: { round: 'Round 2' },
        link: 'rounds',
      });
      expect(checklist.blocked).toBe(true);
    }
  });

  it('is done once the last round is completed', () => {
    const checklist = buildStartupChecklist(input({ rounds: [round(2), round(1)] }));

    expect(item(checklist.items, 'previousRound')).toMatchObject({ state: 'done', params: { round: 'Round 2' } });
    expect(checklist.blocked).toBe(false);
  });

  it('judges the round with the highest number, whatever the order of the list', () => {
    const checklist = buildStartupChecklist(input({ rounds: [round(2, 'active'), round(1), round(3)] }));

    expect(item(checklist.items, 'previousRound')?.state).toBe('done');
  });

  it('treats a legacy elimination bracket (rounds without a bracket side) like Swiss', () => {
    const checklist = buildStartupChecklist(
      input({ bracketType: 'single_elim', rounds: [round(1, 'active', null)] }),
    );

    expect(item(checklist.items, 'previousRound')?.state).toBe('blocked');
    expect(checklist.blocked).toBe(true);
    expect(checklist.roundRobin).toBeNull();
  });

  it('has nothing to say about an elimination bracket the bracket engine built', () => {
    for (const bracketType of ['single_elim', 'double_elim'] as const) {
      const checklist = buildStartupChecklist(
        input({ bracketType, rounds: [round(1, 'active', 'winners'), round(2, 'pending', 'winners')] }),
      );

      expect(checklist).toEqual({ items: [], blocked: false, roundRobin: null });
    }
  });

  it('still lists the setup items of an elimination bracket that is not generated yet', () => {
    const checklist = buildStartupChecklist(input({ bracketType: 'double_elim', participants: field(1) }));

    expect(item(checklist.items, 'participants')?.state).toBe('blocked');
    expect(checklist.blocked).toBe(true);
  });

  it('has nothing to say about a completed tournament', () => {
    const checklist = buildStartupChecklist(
      input({ tournamentStatus: 'completed', rounds: [round(1, 'active')], participants: field(0) }),
    );

    expect(checklist.items).toEqual([]);
    expect(checklist.blocked).toBe(false);
  });
});

describe('buildStartupChecklist — round robin', () => {
  // 6 participants play 5 rounds.
  const rr = (rounds: RoundRow[], overrides: Partial<StartupChecklistInput> = {}) =>
    buildStartupChecklist(input({ bracketType: 'round_robin', participants: field(6), rounds, ...overrides }));

  it('has no previous-round row: round robin rounds can be generated ahead', () => {
    expect(item(rr([round(1, 'active')]).items, 'previousRound')).toBeUndefined();
  });

  it('blocks once every round exists', () => {
    const checklist = rr([1, 2, 3, 4, 5].map((n) => round(n, 'pending')));

    expect(checklist.roundRobin).toMatchObject({ total: 5, generated: 5, allGenerated: true, firstMissing: null });
    expect(item(checklist.items, 'roundsRemaining')).toMatchObject({
      state: 'blocked',
      params: { total: 5, generated: 5 },
    });
    expect(checklist.blocked).toBe(true);
  });

  it('points at a gap once the last round number is reached', () => {
    const checklist = rr([1, 2, 4, 5].map((n) => round(n)));

    // The highest number (5) is the last round, so Generate Next has nothing after it; Generate All fills round 3.
    expect(checklist.roundRobin).toMatchObject({
      total: 5,
      generated: 4,
      allGenerated: false,
      pastLast: true,
      firstMissing: 3,
    });
    expect(item(checklist.items, 'roundsRemaining')).toMatchObject({
      state: 'attention',
      params: { round: 3, total: 5, generated: 4 },
    });
    expect(checklist.blocked).toBe(false);
  });

  it('does not block while rounds are still to come', () => {
    const checklist = rr([1, 2, 3].map((n) => round(n, 'pending')));

    expect(checklist.roundRobin).toMatchObject({ generated: 3, allGenerated: false, pastLast: false, firstMissing: 4 });
    expect(item(checklist.items, 'roundsRemaining')).toMatchObject({
      state: 'done',
      params: { total: 5, generated: 3 },
    });
    expect(checklist.blocked).toBe(false);
  });

  it('leaves the progress to the server when groups are in use', () => {
    const checklist = rr([1, 2, 3, 4, 5].map((n) => round(n)), { groupsInUse: true });

    expect(checklist.roundRobin).toBeNull();
    expect(item(checklist.items, 'roundsRemaining')).toBeUndefined();
    expect(checklist.blocked).toBe(false);
  });

  it('hides the rounds-remaining row while there are no participants yet', () => {
    const checklist = rr([round(1, 'pending')], { participants: field(0) });

    expect(item(checklist.items, 'roundsRemaining')).toBeUndefined();
    expect(checklist.blocked).toBe(false);
  });

  it('has no progress while the participants are unknown', () => {
    const checklist = rr([round(1)], { participants: null });

    expect(checklist.roundRobin).toBeNull();
    expect(checklist.items).toEqual([]);
  });
});

describe('participantsSectionOpen', () => {
  const base = { isNewPhase: false, participantCount: 0 };

  it('opens while there are too few participants to pair', () => {
    expect(participantsSectionOpen({ ...base, participantCount: 0 })).toBe(true);
    expect(participantsSectionOpen({ ...base, participantCount: 1 })).toBe(true);
    expect(participantsSectionOpen({ ...base, participantCount: 2 })).toBe(false);
  });

  it('opens for a new phase with participants', () => {
    expect(participantsSectionOpen({ isNewPhase: true, participantCount: 8 })).toBe(true);
  });

  it('stays collapsed for a phase fed by a previous phase, whatever its participant count', () => {
    const rule = { type: 'top_n', count: 2, per_group: true };
    expect(participantsSectionOpen({ ...base, advancementRule: rule })).toBe(false);
    expect(participantsSectionOpen({ ...base, enrollmentSourceType: 'standings' })).toBe(false);
    expect(participantsSectionOpen({ ...base, stageOrder: 2 })).toBe(false);
    expect(participantsSectionOpen({ ...base, participantCount: 1, advancementRule: rule })).toBe(false);
  });

  it('opens for a first stage or a roster-fed phase with too few participants', () => {
    expect(participantsSectionOpen({ ...base, stageOrder: 1, advancementRule: null, enrollmentSourceType: 'roster' })).toBe(true);
  });
});

describe('roundRobinProgress', () => {
  it('counts n - 1 rounds for an even field and n for an odd one', () => {
    expect(roundRobinProgress(6, []).total).toBe(5);
    expect(roundRobinProgress(7, []).total).toBe(7);
    expect(roundRobinProgress(2, []).total).toBe(1);
    expect(roundRobinProgress(0, []).total).toBe(0);
  });

  it('counts distinct round numbers within 1..total', () => {
    const progress = roundRobinProgress(7, [1, 1, 2, 9].map((n) => ({ round_number: n })));

    expect(progress).toEqual({ total: 7, generated: 2, allGenerated: false, pastLast: true, firstMissing: 3 });
  });

  it('knows an empty list has nothing generated', () => {
    expect(roundRobinProgress(4, [])).toEqual({
      total: 3,
      generated: 0,
      allGenerated: false,
      pastLast: false,
      firstMissing: 1,
    });
  });

  it('is never "all generated" for a field that plays nothing', () => {
    expect(roundRobinProgress(0, []).allGenerated).toBe(false);
    expect(roundRobinProgress(0, [{ round_number: 1 }]).pastLast).toBe(false);
  });
});

describe('nextRoundToStart', () => {
  const r = (round_number: number, status: RoundStatus) => ({ round_number, status });

  it('offers a lone pending round', () => {
    expect(nextRoundToStart([r(1, 'pending')])).toEqual(r(1, 'pending'));
  });

  it('offers the next pending round after a completed one', () => {
    expect(nextRoundToStart([r(1, 'completed'), r(2, 'pending')])).toEqual(r(2, 'pending'));
  });

  it('offers nothing while an earlier round is active', () => {
    expect(nextRoundToStart([r(1, 'active'), r(2, 'pending')])).toBeNull();
  });

  it('offers the first of several pending rounds (round robin generated ahead)', () => {
    expect(nextRoundToStart([r(3, 'pending'), r(1, 'pending'), r(2, 'pending')])).toEqual(r(1, 'pending'));
  });

  it('offers nothing when no round is pending', () => {
    expect(nextRoundToStart([])).toBeNull();
    expect(nextRoundToStart([r(1, 'completed'), r(2, 'active')])).toBeNull();
  });

  it('returns the caller\'s own object', () => {
    const rounds = [{ ...r(1, 'completed'), id: 'a' }, { ...r(2, 'pending'), id: 'b' }];
    expect(nextRoundToStart(rounds)).toBe(rounds[1]);
  });
});
