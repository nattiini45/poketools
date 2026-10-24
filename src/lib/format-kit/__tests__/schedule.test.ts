import { describe, expect, it } from 'vitest';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { buildDoubleElimStructure, buildSingleElimStructure, type BracketSlotDef, type BracketStructure } from '@/lib/tournament/bracket-structure';
import { compile } from '../compile.browser';
import { CURRENT_ENV } from '../engine/env';
import {
  SCHEDULE_CADENCES,
  SCHEDULE_DEFAULT_PLAYERS,
  SCHEDULE_DEFAULT_ROUND_DAYS,
  estimateSchedule,
  minRosterFor,
  type ScheduleEstimate,
  type StageSchedule,
} from '../engine/schedule';
import { PRESETS } from '../presets';
import type { FormatDefinition, Pairing, Stage } from '../types';
import { makeDefinition, makeEdge, makeRosterStage, makeStage } from './fixtures/negative';

const SIZES = Array.from({ length: 32 }, (_, i) => i + 2); // 2..33

/** Compiles with the roster size and estimates; the compile result must carry a plan. */
function estimate(def: FormatDefinition, players: number, roundDays?: number): ScheduleEstimate {
  const result = compile(def, { ...CURRENT_ENV, rosterSize: players });
  const out = estimateSchedule(result, { players, roundDays });
  if (out === null) throw new Error(`definition did not compile: ${JSON.stringify(result.diagnostics.slice(0, 3))}`);
  return out;
}

function one(stage: Stage, players: number, roundDays?: number): StageSchedule {
  const out = estimate(makeDefinition([stage]), players, roundDays);
  expect(out.stages).toHaveLength(1);
  return out.stages[0];
}

const rosterStage = (pairing: Pairing, extra: Partial<Stage> = {}): Stage => makeRosterStage('a', { pairing, rank: [], ...extra });

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Matches, byes and rounds of one round robin group from the real generator. */
function roundRobinTruth(size: number, legs: number) {
  if (size < 2) return { matches: 0, byes: 0, rounds: 0 };
  const total = getRoundRobinTotalRounds(size);
  let matches = 0;
  let byes = 0;
  for (let round = 1; round <= total; round += 1) {
    const generated = generateRoundRobinRound(ids(size), round);
    matches += generated.pairings.length;
    byes += generated.bye_player_ids.length;
  }
  return { matches: matches * legs, byes: byes * legs, rounds: total * legs };
}

/**
 * Real matches of a bracket: a slot is a match when both of its feeders bring a player. A seed brings one, a bye none,
 * the winner of a slot exists when at least one feeder does, the loser only when the slot was a real match.
 */
function bracketTruth(structure: BracketStructure) {
  const bySlot = new Map<string, { match: boolean; winner: boolean; bye: boolean; reset: boolean }>();
  const brings = (feeder: BracketSlotDef['feeder1']): boolean => {
    if (feeder.kind === 'seed') return true;
    if (feeder.kind === 'bye') return false;
    const source = bySlot.get(feeder.slotKey ?? '');
    if (!source) throw new Error(`slot ${feeder.slotKey} is not defined before its use`);
    return feeder.kind === 'winner' ? source.winner : source.match;
  };
  let matches = 0;
  let resetMatches = 0;
  let byes = 0;
  for (const slot of structure.slots) {
    const a = brings(slot.feeder1);
    const b = brings(slot.feeder2);
    const reset = slot.isBracketReset === true;
    bySlot.set(slot.slotKey, { match: a && b, winner: a || b, bye: slot.feeder1.kind === 'bye' || slot.feeder2.kind === 'bye', reset });
    if (a && b) {
      if (reset) resetMatches += 1;
      else matches += 1;
    }
    if (slot.feeder1.kind === 'bye' || slot.feeder2.kind === 'bye') byes += 1;
  }
  return { matches, resetMatches, byes };
}

describe('round robin', () => {
  it.each([1, 2, 3])('matches, byes and rounds equal the real generator, legs %i, n = 2..33', (legs) => {
    for (const n of SIZES) {
      const truth = roundRobinTruth(n, legs);
      const stage = one(rosterStage({ kind: 'round_robin', legs, mirror_legs: true }), n);
      expect(stage.matches, `n=${n}`).toEqual({ min: truth.matches, max: truth.matches });
      expect(stage.byes, `n=${n}`).toEqual({ min: truth.byes, max: truth.byes });
      expect(stage.rounds, `n=${n}`).toEqual({ min: truth.rounds, max: truth.rounds });
      expect(stage.matchesPerPlayer, `n=${n}`).toEqual({ min: legs * (n - 1), max: legs * (n - 1) });
      expect(stage.precision).toBe('exact');
    }
  });

  it('splits uneven groups: 7 players in 2 groups play as 4 and 3', () => {
    const a = roundRobinTruth(4, 1);
    const b = roundRobinTruth(3, 1);
    const stage = one(rosterStage({ kind: 'round_robin', legs: 1, mirror_legs: true }, { groups: { count: 2, method: 'serpentine' } }), 7);
    expect(stage.groups).toBe(2);
    expect(stage.matches).toEqual({ min: a.matches + b.matches, max: a.matches + b.matches });
    expect(stage.byes).toEqual({ min: a.byes + b.byes, max: a.byes + b.byes });
    expect(stage.rounds).toEqual({ min: Math.max(a.rounds, b.rounds), max: Math.max(a.rounds, b.rounds) });
    expect(stage.matchesPerPlayer).toEqual({ min: 2, max: 3 });
  });

  it('matches the real generator for every group split of 2..33 players in 2..4 groups', () => {
    for (const groups of [2, 3, 4]) {
      for (const n of SIZES) {
        if (n < groups * 2) continue;
        const base = Math.floor(n / groups);
        const larger = n % groups;
        const sizes = [...Array.from({ length: larger }, () => base + 1), ...Array.from({ length: groups - larger }, () => base)];
        const truth = sizes.map((size) => roundRobinTruth(size, 1));
        const stage = one(rosterStage({ kind: 'round_robin', legs: 1, mirror_legs: true }, { groups: { count: groups, method: 'straight' } }), n);
        const matches = truth.reduce((sum, t) => sum + t.matches, 0);
        const byes = truth.reduce((sum, t) => sum + t.byes, 0);
        expect(stage.matches, `n=${n} g=${groups}`).toEqual({ min: matches, max: matches });
        expect(stage.byes, `n=${n} g=${groups}`).toEqual({ min: byes, max: byes });
      }
    }
  });
});

describe('swiss', () => {
  it('auto rounds follow ceil(log2 n); matches and byes come from the formulas', () => {
    for (const n of SIZES) {
      const rounds = Math.ceil(Math.log2(n));
      const stage = one(rosterStage({ kind: 'swiss', rounds: 'auto', avoid_repeats: true }), n);
      expect(stage.rounds, `n=${n}`).toEqual({ min: rounds, max: rounds });
      expect(stage.matches, `n=${n}`).toEqual({ min: rounds * Math.floor(n / 2), max: rounds * Math.floor(n / 2) });
      expect(stage.byes, `n=${n}`).toEqual({ min: n % 2 ? rounds : 0, max: n % 2 ? rounds : 0 });
      expect(stage.matchesPerPlayer, `n=${n}`).toEqual({ min: n % 2 ? rounds - 1 : rounds, max: rounds });
    }
  });

  it('a fixed round count is used as given', () => {
    const stage = one(rosterStage({ kind: 'swiss', rounds: 5, avoid_repeats: true }), 9);
    expect(stage.rounds).toEqual({ min: 5, max: 5 });
    expect(stage.matches).toEqual({ min: 20, max: 20 });
    expect(stage.byes).toEqual({ min: 5, max: 5 });
  });
});

describe('single elimination', () => {
  it('matches, rounds and byes equal the real bracket for n = 2..33', () => {
    for (const n of SIZES) {
      const structure = buildSingleElimStructure(n);
      const truth = bracketTruth(structure);
      const stage = one(rosterStage({ kind: 'single_elim', third_place: false }), n);
      expect(stage.matches, `n=${n}`).toEqual({ min: truth.matches, max: truth.matches });
      expect(stage.rounds, `n=${n}`).toEqual({ min: structure.rounds.length, max: structure.rounds.length });
      expect(stage.byes, `n=${n}`).toEqual({ min: truth.byes, max: truth.byes });
      expect(stage.matchesPerPlayer?.min).toBe(1);
      expect(stage.matchesPerPlayer?.max).toBe(structure.rounds.length);
      expect(stage.precision).toBe('bounds');
    }
  });

  it('a third-place match adds one match and no round', () => {
    for (const n of [4, 5, 8, 16, 33]) {
      const plain = one(rosterStage({ kind: 'single_elim', third_place: false }), n);
      const third = one(rosterStage({ kind: 'single_elim', third_place: true }), n);
      expect(third.matches?.max).toBe((plain.matches?.max ?? 0) + 1);
      expect(third.rounds).toEqual(plain.rounds);
    }
  });
});

describe('double elimination', () => {
  it('matches equal the real bracket for n = 2..33, with and without the reset', () => {
    for (const n of SIZES) {
      const without = bracketTruth(buildDoubleElimStructure(n, undefined, false));
      const withReset = bracketTruth(buildDoubleElimStructure(n, undefined, true));
      expect(withReset.matches, `n=${n}`).toBe(without.matches);
      expect(withReset.resetMatches, `n=${n}`).toBe(1);
      const plain = one(rosterStage({ kind: 'double_elim', bracket_reset: false }), n);
      expect(plain.matches, `n=${n}`).toEqual({ min: without.matches, max: without.matches });
      const reset = one(rosterStage({ kind: 'double_elim', bracket_reset: true }), n);
      // The reset match is only played when the loser-side finalist wins the grand final: an upper bound.
      expect(reset.matches, `n=${n}`).toEqual({ min: without.matches, max: without.matches + 1 });
      expect(reset.precision).toBe('bounds');
    }
  });

  it('a player plays at least two matches, at most the round count', () => {
    const stage = one(rosterStage({ kind: 'double_elim', bracket_reset: false }), 8);
    expect(stage.rounds).toEqual({ min: 5, max: 5 });
    expect(stage.matchesPerPlayer).toEqual({ min: 2, max: 5 });
    const two = one(rosterStage({ kind: 'double_elim', bracket_reset: false }), 2);
    expect(two.matchesPerPlayer?.min).toBeLessThanOrEqual(two.matchesPerPlayer?.max ?? 0);
  });
});

describe('manual pairing and invalid documents', () => {
  it('a manual stage is unknown in every number', () => {
    const stage = one(rosterStage({ kind: 'manual' }), 8);
    expect(stage).toMatchObject({ rounds: null, matches: null, matchesPerPlayer: null, byes: null, weeks: null, precision: 'unknown' });
    expect(stage.participants).toEqual({ min: 8, max: 8 });
  });

  it('a manual stage makes the totals unknown', () => {
    const def = makeDefinition(
      [makeRosterStage('a'), makeStage('b', { pairing: { kind: 'manual' } })],
      [makeEdge('e', 'a', 'b')],
    );
    const out = estimate(def, 8);
    expect(out.totals).toEqual({ rounds: null, matches: null, weeks: null });
  });

  it('returns null when the document has no definition', () => {
    const result = compile({ schema_version: 1 }, CURRENT_ENV);
    expect(result.definition).toBeNull();
    expect(estimateSchedule(result, { players: 8 })).toBeNull();
  });

  it('a stage without a participant count is unknown', () => {
    const result = compile(makeDefinition([makeRosterStage('a')]), CURRENT_ENV);
    const out = estimateSchedule(result, { players: 8 });
    expect(out?.stages[0].precision).toBe('unknown');
    expect(out?.stages[0].participants).toBeNull();
  });
});

describe('ranges and totals', () => {
  const thresholdDef = (): FormatDefinition => {
    const edge = makeEdge('e', 'a', 'b', [{ kind: 'threshold', when: { k: 'bool', v: true } }]);
    return makeDefinition([makeRosterStage('a'), makeStage('b')], [edge]);
  };

  it('a threshold selection gives a participant range with min <= max everywhere', () => {
    const out = estimate(thresholdDef(), 12);
    const stage = out.stages[1];
    expect(stage.participants).toEqual({ min: 0, max: 12 });
    for (const range of [stage.rounds, stage.matches, stage.matchesPerPlayer, stage.byes, stage.weeks]) {
      expect(range).not.toBeNull();
      expect((range?.min ?? 1)).toBeLessThanOrEqual(range?.max ?? 0);
    }
    expect(stage.matches).toEqual({ min: 0, max: 11 });
    expect(stage.precision).toBe('bounds');
  });

  it('weeks round up per cadence: 13 rounds at 7 days is 2 weeks', () => {
    // 14 players in a round robin play 13 rounds.
    const rr = one(rosterStage({ kind: 'round_robin', legs: 1, mirror_legs: true }), 14, 7);
    expect(rr.rounds).toEqual({ min: 13, max: 13 });
    expect(rr.weeks).toEqual({ min: 13, max: 13 });
    const cadence = one(rosterStage({ kind: 'round_robin', legs: 1, mirror_legs: true }), 14, 14);
    expect(cadence.weeks).toEqual({ min: 26, max: 26 });
    const daily = one(rosterStage({ kind: 'round_robin', legs: 1, mirror_legs: true }), 14, 1);
    expect(daily.weeks).toEqual({ min: 2, max: 2 });
  });

  it('adds the rounds first and rounds once: stage rounding does not accumulate', () => {
    // Two stages of 3 rounds at 3 days: each is ceil(9 / 7) = 2 weeks, together ceil(18 / 7) = 3 weeks.
    const def = makeDefinition(
      [
        makeRosterStage('a', { pairing: { kind: 'swiss', rounds: 3, avoid_repeats: true }, rank: [] }),
        makeStage('b', { pairing: { kind: 'swiss', rounds: 3, avoid_repeats: true } }),
      ],
      [makeEdge('e', 'a', 'b', [{ kind: 'top_n', n: 4 }])],
    );
    const out = estimate(def, 8, 3);
    expect(out.stages.map((s) => s.weeks)).toEqual([
      { min: 2, max: 2 },
      { min: 2, max: 2 },
    ]);
    expect(out.totals.rounds).toEqual({ min: 6, max: 6 });
    expect(out.totals.weeks).toEqual({ min: 3, max: 3 });
  });

  it('an invalid cadence falls back to 7 days and the players are clamped', () => {
    const def = makeDefinition([rosterStage({ kind: 'round_robin', legs: 1, mirror_legs: true })]);
    expect(estimate(def, 8, 0).roundDays).toBe(SCHEDULE_DEFAULT_ROUND_DAYS);
    expect(estimate(def, 8, 2.5).roundDays).toBe(SCHEDULE_DEFAULT_ROUND_DAYS);
    expect(estimate(def, 8, 29).roundDays).toBe(SCHEDULE_DEFAULT_ROUND_DAYS);
    const result = compile(def, { ...CURRENT_ENV, rosterSize: 8 });
    expect(estimateSchedule(result, { players: 1 })?.players).toBe(2);
    expect(estimateSchedule(result, { players: 100000 })?.players).toBe(4096);
    expect(estimateSchedule(result, { players: Number.NaN })?.players).toBe(2);
  });

  it('lists stages in graph order, then stages missing from the graph', () => {
    const def = makeDefinition(
      [makeStage('late'), makeRosterStage('early')],
      [makeEdge('e', 'early', 'late')],
    );
    expect(estimate(def, 8).stages.map((s) => s.key)).toEqual(['early', 'late']);
  });

  it('exports the cadences the UI offers, including the default', () => {
    expect(SCHEDULE_CADENCES).toContain(SCHEDULE_DEFAULT_ROUND_DAYS);
    expect(SCHEDULE_DEFAULT_PLAYERS).toBe(8);
  });
});

describe('minRosterFor', () => {
  it('is 2 when no stage is fed by the roster', () => {
    expect(minRosterFor(makeDefinition([makeStage('a')]))).toBe(2);
  });

  it('is 2 for roster stages without groups', () => {
    expect(minRosterFor(makeDefinition([makeRosterStage('a'), makeRosterStage('b')]))).toBe(2);
  });

  it('is twice the group count for a roster stage with groups; the largest need wins', () => {
    const grouped = (count: number) => makeRosterStage('g', { groups: { count, method: 'serpentine' } });
    expect(minRosterFor(makeDefinition([grouped(4)]))).toBe(8);
    expect(minRosterFor(makeDefinition([grouped(4), makeRosterStage('b', { groups: { count: 6, method: 'straight' } })]))).toBe(12);
  });

  it('ignores groups on a stage that is fed by edges', () => {
    const fed = makeStage('f', { groups: { count: 8, method: 'serpentine' } });
    expect(minRosterFor(makeDefinition([makeRosterStage('a'), fed], [makeEdge('e', 'a', 'f')]))).toBe(2);
  });
});

describe('presets (pinned)', () => {
  const preset = (id: string): FormatDefinition => {
    const found = PRESETS.find((entry) => entry.id === id);
    if (!found) throw new Error(`no preset ${id}`);
    return found.definition;
  };
  const summary = (out: ScheduleEstimate) =>
    out.stages.map((s) => ({ key: s.key, participants: s.participants, rounds: s.rounds, matches: s.matches, byes: s.byes, weeks: s.weeks }));
  const exact = (n: number) => ({ min: n, max: n });

  it('classic league at 8 players', () => {
    const out = estimate(preset('classic-league'), 8);
    expect(summary(out)).toEqual([
      { key: 'league', participants: exact(8), rounds: exact(14), matches: exact(56), byes: exact(0), weeks: exact(14) },
      { key: 'playoffs', participants: exact(4), rounds: exact(2), matches: exact(3), byes: exact(0), weeks: exact(2) },
    ]);
    expect(out.totals).toEqual({ rounds: exact(16), matches: exact(59), weeks: exact(16) });
  });

  it('classic league at 12 players', () => {
    const out = estimate(preset('classic-league'), 12);
    expect(out.stages[0].matches).toEqual(exact(132));
    expect(out.stages[0].rounds).toEqual(exact(22));
    expect(out.totals.matches).toEqual(exact(135));
  });

  it('cup at 8 and 12 players', () => {
    // Four groups; the best two of each reach an eight-player knockout (seven matches).
    const at8 = estimate(preset('cup'), 8);
    expect(at8.stages[0].matches).toEqual(exact(4)); // groups of two
    expect(at8.stages[1].matches).toEqual(exact(7));
    expect(at8.totals.matches).toEqual(exact(11));
    const at12 = estimate(preset('cup'), 12);
    expect(at12.stages[0].matches).toEqual(exact(12)); // groups of three
    expect(at12.stages[0].byes).toEqual(exact(12)); // an odd group rests one player every round
    expect(at12.stages[0].matchesPerPlayer).toEqual(exact(2));
    expect(at12.totals.matches).toEqual(exact(19));
  });

  it('swiss with top cut at 8 and 12 players', () => {
    const at8 = estimate(preset('swiss-top-cut'), 8);
    expect(summary(at8)[0]).toMatchObject({ key: 'swiss', rounds: exact(3), matches: exact(12) });
    expect(at8.stages[1].matches).toEqual(exact(8)); // seven bracket matches plus the third-place match
    const at12 = estimate(preset('swiss-top-cut'), 12);
    expect(at12.stages[0].rounds).toEqual(exact(4));
    expect(at12.stages[0].matches).toEqual(exact(24));
    expect(at12.totals.rounds).toEqual(exact(7));
  });
});
