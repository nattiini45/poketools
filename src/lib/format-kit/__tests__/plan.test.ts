import { describe, expect, it } from 'vitest';
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { analyzeDefinition } from '../engine/core';
import { CURRENT_ENV, type CompileEnv } from '../engine/env';
import { buildStageGraph } from '../engine/graph';
import { buildPlan, ceilLog2, mapRange, nextPowerOfTwo } from '../engine/plan';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import type { FormatDefinition, Stage } from '../types';
import { makeDefinition, makeEdge, makeRosterStage, makeStage, rosterEnv } from './fixtures/negative';

function planOf(def: FormatDefinition, env: CompileEnv = CURRENT_ENV) {
  return buildPlan(def, env, buildStageGraph(def));
}

describe('plan counts', () => {
  it('16 players in 4 groups, top 2 of each group, into a bracket of 8', () => {
    const { byKey, diagnostics } = planOf(cup, rosterEnv(16));
    expect(diagnostics).toEqual([]);
    expect(byKey.get('groups')).toMatchObject({
      participants: { min: 16, max: 16 },
      groupSize: { min: 4, max: 4 },
      rounds: { min: 3, max: 3 },
      mappedBracketType: 'round_robin',
    });
    expect(byKey.get('knockout')).toMatchObject({
      participants: { min: 8, max: 8 },
      rounds: { min: 3, max: 3 },
      bracketSize: 8,
      byes: 0,
      mappedBracketType: 'single_elim',
    });
  });

  it('6 qualifiers need a bracket of 8 and give 2 byes', () => {
    const def: FormatDefinition = JSON.parse(JSON.stringify(cup));
    def.stages[0].groups = { count: 3, method: 'serpentine' };
    const knockout = planOf(def, rosterEnv(12)).byKey.get('knockout');
    expect(knockout).toMatchObject({ participants: { min: 6, max: 6 }, bracketSize: 8, byes: 2 });
  });

  it('counts round-robin rounds with the production helper: n for odd, n - 1 for even', () => {
    const rounds = (n: number, legs = 1) => {
      const def = makeDefinition([makeRosterStage('rr', { pairing: { kind: 'round_robin', legs, mirror_legs: true } })]);
      return planOf(def, rosterEnv(n)).byKey.get('rr')?.rounds;
    };
    expect(rounds(5)).toEqual({ min: 5, max: 5 });
    expect(rounds(6)).toEqual({ min: 5, max: 5 });
    expect(rounds(6, 2)).toEqual({ min: 10, max: 10 });
    expect(rounds(1)).toEqual({ min: 0, max: 0 });
    for (let n = 2; n < 12; n += 1) expect(rounds(n)?.min).toBe(getRoundRobinTotalRounds(n));
  });

  it('uses the size of the biggest group for a grouped round robin', () => {
    const def = makeDefinition([
      makeRosterStage('g', { groups: { count: 2, method: 'serpentine' }, pairing: { kind: 'round_robin', legs: 1, mirror_legs: true } }),
    ]);
    const plan = planOf(def, rosterEnv(11)).byKey.get('g');
    expect(plan?.groupSize).toEqual({ min: 5, max: 6 });
    expect(plan?.rounds).toEqual({ min: 5, max: 5 });
  });

  it('plans Swiss rounds, fixed or following the field size', () => {
    const swiss = (rounds: number | 'auto') =>
      makeDefinition([makeRosterStage('s', { pairing: { kind: 'swiss', rounds, avoid_repeats: true } })]);
    expect(planOf(swiss('auto'), rosterEnv(32)).byKey.get('s')?.rounds).toEqual({ min: 5, max: 5 });
    expect(planOf(swiss('auto'), rosterEnv(10)).byKey.get('s')?.rounds).toEqual({ min: 4, max: 4 });
    expect(planOf(swiss(7), rosterEnv(10)).byKey.get('s')?.rounds).toEqual({ min: 7, max: 7 });
    expect(planOf(swiss('auto')).byKey.get('s')?.rounds).toBeNull();
  });

  it('plans elimination rounds and byes', () => {
    const elim = (pairing: Stage['pairing']) => makeDefinition([makeRosterStage('e', { pairing, rank: [] })]);
    expect(planOf(elim({ kind: 'single_elim', third_place: true }), rosterEnv(5)).byKey.get('e')).toMatchObject({
      rounds: { min: 3, max: 3 },
      bracketSize: 8,
      byes: 3,
    });
    expect(planOf(elim({ kind: 'double_elim', bracket_reset: false }), rosterEnv(8)).byKey.get('e')?.rounds).toEqual({ min: 5, max: 5 });
    expect(planOf(elim({ kind: 'double_elim', bracket_reset: true }), rosterEnv(8)).byKey.get('e')?.rounds).toEqual({ min: 6, max: 6 });
    expect(planOf(elim({ kind: 'single_elim', third_place: false }), rosterEnv(1)).byKey.get('e')).toMatchObject({
      rounds: { min: 0, max: 0 },
      bracketSize: null,
    });
  });

  it('maps manual pairing to a round-robin bracket type with unknown rounds', () => {
    const def = makeDefinition([makeRosterStage('m', { pairing: { kind: 'manual' } })]);
    expect(planOf(def, rosterEnv(8)).byKey.get('m')).toMatchObject({ mappedBracketType: 'round_robin', rounds: null });
  });

  it('caps top_n at the source size and sends 0..max for a threshold', () => {
    const top = makeDefinition([makeRosterStage('a'), makeStage('b')], [makeEdge('e', 'a', 'b', [{ kind: 'top_n', n: 4 }])]);
    expect(planOf(top, rosterEnv(3)).byKey.get('b')?.participants).toEqual({ min: 3, max: 3 });
    const when = { k: 'bool', v: true } as const;
    const thr = makeDefinition([makeRosterStage('a'), makeStage('b')], [makeEdge('e', 'a', 'b', [{ kind: 'threshold', when }])]);
    expect(planOf(thr, rosterEnv(9)).byKey.get('b')?.participants).toEqual({ min: 0, max: 9 });
  });

  it('adds up the selects of an edge and the edges into a stage', () => {
    const def = makeDefinition(
      [makeRosterStage('a', { groups: { count: 2, method: 'serpentine' } }), makeRosterStage('c'), makeStage('b')],
      [
        makeEdge('e1', 'a', 'b', [
          { kind: 'per_group', n: 2 },
          { kind: 'wildcard', n: 1 },
        ]),
        makeEdge('e2', 'c', 'b', [{ kind: 'bottom_n', n: 2 }]),
      ],
    );
    expect(planOf(def, rosterEnv(12)).byKey.get('b')?.participants).toEqual({ min: 7, max: 7 });
  });

  it('cannot count an open manual list', () => {
    const def = makeDefinition([makeRosterStage('a'), makeStage('b')], [makeEdge('e', 'a', 'b', [{ kind: 'manual_list' }])]);
    expect(planOf(def, rosterEnv(8)).byKey.get('b')?.participants).toBeNull();
    const counted = makeDefinition([makeRosterStage('a'), makeStage('b')], [makeEdge('e', 'a', 'b', [{ kind: 'manual_list', count: 3 }])]);
    expect(planOf(counted, rosterEnv(8)).byKey.get('b')?.participants).toEqual({ min: 3, max: 3 });
  });

  it('prefers the roster size of the environment over expected_count', () => {
    const def = makeDefinition([makeRosterStage('a', { participants: { from: 'roster', seeding: 'signup', expected_count: 10 } })]);
    const expected = planOf(def);
    expect(expected.byKey.get('a')?.participants).toEqual({ min: 10, max: 10 });
    expect(expected.sources.get('a')).toBe('expected_count');
    expect(planOf(def, rosterEnv(12)).sources.get('a')).toBe('roster');
    expect(expected.diagnostics).toEqual([]);
  });

  it('reports a per-group selection from a stage without groups and still counts it as unknown', () => {
    const def = makeDefinition([makeRosterStage('a'), makeStage('b')], [makeEdge('e', 'a', 'b', [{ kind: 'per_group', n: 2 }])]);
    const { diagnostics, byKey } = planOf(def, rosterEnv(8));
    expect(diagnostics.map((d) => d.code)).toEqual(['advance_per_group_without_groups']);
    expect(diagnostics[0].json_pointer).toBe('/edges/0/select/0');
    expect(byKey.get('b')?.participants).toBeNull();
  });

  it('leaves counts empty for stages on a cycle', () => {
    const def = makeDefinition([makeStage('a'), makeStage('b')], [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a')]);
    const { byKey } = planOf(def, rosterEnv(8));
    expect(byKey.get('a')?.participants).toBeNull();
    expect(byKey.get('b')?.participants).toBeNull();
  });
});

describe('unknown roster', () => {
  const def = makeDefinition(
    [makeRosterStage('one'), makeRosterStage('two'), makeStage('cut'), makeStage('final')],
    [makeEdge('e1', 'one', 'cut', [{ kind: 'top_n', n: 4 }]), makeEdge('e2', 'cut', 'final', [{ kind: 'top_n', n: 2 }])],
  );

  it('plans null counts and reports exactly one note per roster stage', () => {
    const { plan, diagnostics } = planOf(def);
    expect(plan.every((p) => p.participants === null)).toBe(true);
    const unknown = diagnostics.filter((d) => d.code === 'participant_count_unknown');
    expect(unknown.map((d) => d.params.stage)).toEqual(['one', 'two']);
    expect(unknown.every((d) => d.severity === 'info')).toBe(true);
  });

  it('produces no diagnostic that needs a count', () => {
    const codes = new Set(analyzeDefinition(def, CURRENT_ENV).diagnostics.map((d) => d.code));
    for (const code of [
      'stage_too_few_participants',
      'groups_too_many',
      'groups_uneven',
      'advance_exceeds_source',
      'advance_bracket_byes',
      'advance_overlap',
      'swiss_rounds_too_many',
      'series_override_unreachable',
    ] as const) {
      expect(codes.has(code)).toBe(false);
    }
  });
});

describe('plan helpers', () => {
  it('computes integer logarithms and powers of two exactly', () => {
    expect([1, 2, 3, 4, 5, 8, 9, 1024, 1025].map(ceilLog2)).toEqual([0, 1, 2, 2, 3, 3, 4, 10, 11]);
    expect([1, 2, 3, 5, 8, 9].map(nextPowerOfTwo)).toEqual([1, 2, 4, 8, 8, 16]);
  });

  it('maps a wide range through its ends instead of looping over it', () => {
    expect(mapRange({ min: 0, max: 1_000_000 }, (n) => n % 2)).toEqual({ min: 0, max: 1 });
    expect(mapRange({ min: 4, max: 7 }, getRoundRobinTotalRounds)).toEqual({ min: 3, max: 7 });
  });

  it('ignores a roster size that is not a safe integer', () => {
    const def = makeDefinition([makeRosterStage('a')]);
    const plan = planOf(def, { ...CURRENT_ENV, rosterSize: Number.POSITIVE_INFINITY });
    expect(plan.byKey.get('a')?.participants).toBeNull();
  });

  it('plans the classic preset for a known roster', () => {
    const { byKey } = planOf(classicLeague, rosterEnv(8));
    expect(byKey.get('league')).toMatchObject({ rounds: { min: 14, max: 14 }, mappedBracketType: 'round_robin' });
    expect(byKey.get('playoffs')).toMatchObject({ participants: { min: 4, max: 4 }, rounds: { min: 2, max: 2 }, bracketSize: 4, byes: 0 });
  });
});
