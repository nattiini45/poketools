import { describe, expect, it } from 'vitest';
import { lookupPath } from '@/i18n/core';
import { formatStudioMessages } from '@/i18n/messages/format-studio';
import { compile } from '../compile';
import {
  compareDiagnostics,
  diag,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_SEVERITY,
  FIX_IDS,
  isDiagnosticCode,
  ptr,
} from '../engine/diagnostics';
import { CURRENT_ENV, envKey } from '../engine/env';
import { USER_CHOICE_FIXES } from '../engine/fixes';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import { swissTopCut } from '../presets/swiss-top-cut';
import { fixtureDiagnostics, mutate, NEGATIVE_FIXTURES, rosterEnv } from './fixtures/negative';

const codesOf = (input: unknown, env = CURRENT_ENV) => compile(input, env).diagnostics.map((d) => `${d.code}@${d.json_pointer}`);
const fixture = (id: string) => {
  const found = NEGATIVE_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

describe('diagnostic vocabulary', () => {
  it('lists 58 distinct codes', () => {
    expect(DIAGNOSTIC_CODES).toHaveLength(58);
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
    expect(DIAGNOSTIC_SEVERITY.size).toBe(58);
  });

  it('has at least one negative fixture for every code, and none for an unknown code', () => {
    const covered = new Set(NEGATIVE_FIXTURES.map((f) => f.code));
    expect(DIAGNOSTIC_CODES.filter((code) => !covered.has(code))).toEqual([]);
    expect([...covered].filter((code) => !isDiagnosticCode(code))).toEqual([]);
    expect(new Set(NEGATIVE_FIXTURES.map((f) => f.id)).size).toBe(NEGATIVE_FIXTURES.length);
  });

  it('gives every fixture the default severity of its code', () => {
    for (const f of NEGATIVE_FIXTURES) expect(f.severity, f.id).toBe(DIAGNOSTIC_SEVERITY.get(f.code));
  });

  it('has a message in both catalogs for every code and a label for every fix id', () => {
    for (const locale of ['en', 'de'] as const) {
      const tree = formatStudioMessages[locale];
      // A sentence is a string, or `{ one, other }` forms when it depends on a count.
      const isText = (value: unknown) =>
        typeof value === 'string' ||
        (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).one === 'string' && typeof (value as Record<string, unknown>).other === 'string');
      for (const code of DIAGNOSTIC_CODES) expect(isText(lookupPath(tree, `diagnostics.${code}`)), `${locale} ${code}`).toBe(true);
      for (const id of FIX_IDS) expect(isText(lookupPath(tree, `fixes.${id}`)), `${locale} ${id}`).toBe(true);
      for (const level of ['error', 'warning', 'info']) expect(typeof lookupPath(tree, `severity.${level}`)).toBe('string');
    }
  });

  it('has no message in the catalog that no code uses', () => {
    const keys = Object.keys(formatStudioMessages.en.diagnostics).sort();
    expect(keys).toEqual([...DIAGNOSTIC_CODES].sort());
    expect(Object.keys(formatStudioMessages.en.fixes).sort()).toEqual([...FIX_IDS].sort());
  });

  it('orders by severity, then pointer, then code', () => {
    const a = diag('rank_open_ended', '/a', {});
    const b = diag('rank_chain_empty', '/a', {});
    const c = diag('rank_chain_empty', '/b', {});
    expect([c, a, b].sort(compareDiagnostics).map((d) => `${d.code}${d.json_pointer}`)).toEqual([
      'rank_chain_empty/a',
      'rank_chain_empty/b',
      'rank_open_ended/a',
    ]);
  });

  it('escapes pointer segments', () => {
    expect(ptr('stages', 0, 'a/b', 'c~d')).toBe('/stages/0/a~1b/c~0d');
    expect(ptr()).toBe('');
  });

  it('keys the environment canonically', () => {
    expect(envKey({ ...CURRENT_ENV, rulesetIds: new Set(['b', 'a']) })).toBe(envKey({ ...CURRENT_ENV, rulesetIds: new Set(['a', 'b']) }));
    expect(envKey(CURRENT_ENV)).not.toBe(envKey({ ...CURRENT_ENV, rosterSize: 4 }));
  });
});

describe('the match-model gate', () => {
  const draws = fixture('draws-scoring').input;
  const series = fixture('draws-series').input;
  const forfeits = fixture('forfeits').input;
  const players = fixture('players-per-match').input;
  const flip = (change: Partial<typeof CURRENT_ENV.matchModel>) => ({ ...CURRENT_ENV, matchModel: { ...CURRENT_ENV.matchModel, ...change } });

  it('refuses draws and forfeits with the current environment', () => {
    expect(codesOf(draws)).toContain('draws_unsupported@/stages/0/scoring/draw');
    expect(codesOf(series)).toContain('draws_unsupported@/stages/0/series/allow_draw');
    expect(codesOf(forfeits)).toContain('forfeits_unsupported@/stages/0/scoring/forfeit');
    expect(compile(draws).ok).toBe(false);
  });

  it('accepts them once the match model records them', () => {
    expect(codesOf(draws, flip({ draws: true })).some((c) => c.startsWith('draws_unsupported'))).toBe(false);
    expect(codesOf(series, flip({ draws: true })).some((c) => c.startsWith('draws_unsupported'))).toBe(false);
    expect(codesOf(forfeits, flip({ forfeits: true })).some((c) => c.startsWith('forfeits_unsupported'))).toBe(false);
    expect(compile(draws, flip({ draws: true })).ok).toBe(true);
    expect(compile(forfeits, flip({ forfeits: true })).ok).toBe(true);
  });

  it('only lets a draw through where the flag it needs is on', () => {
    expect(codesOf(draws, flip({ forfeits: true }))).toContain('draws_unsupported@/stages/0/scoring/draw');
    expect(codesOf(forfeits, flip({ draws: true }))).toContain('forfeits_unsupported@/stages/0/scoring/forfeit');
  });

  it('errors for three players per match with the current environment and passes with room for three', () => {
    expect(codesOf(players)).toContain('players_per_match_unsupported@/stages/0/players_per_match');
    expect(codesOf(players, flip({ maxPlayersPerMatch: 3 })).some((c) => c.startsWith('players_per_match_unsupported'))).toBe(false);
    expect(compile(players).diagnostics.find((d) => d.code === 'players_per_match_unsupported')?.params).toEqual({
      stage: 'league',
      players: 3,
      max: 2,
    });
  });
});

describe('metric production', () => {
  const find = (id: string) => fixture(id);

  it('explains each reason', () => {
    for (const id of ['metric-unknown', 'metric-needs-kill-stats', 'metric-needs-rating', 'metric-needs-opponents', 'metric-view']) {
      const f = find(id);
      const hit = fixtureDiagnostics(f).find((d) => d.code === 'metric_unproduced' && d.json_pointer === f.pointer);
      expect(hit?.params, id).toMatchObject(f.params ?? {});
    }
  });

  it('produces kill differential and rating when the features are on', () => {
    expect(codesOf(classicLeague, rosterEnv(8)).filter((c) => c.startsWith('metric_unproduced'))).toEqual([]);
    const killOff = { ...CURRENT_ENV, features: { killStats: false, rating: true } };
    expect(codesOf(classicLeague, killOff).filter((c) => c.startsWith('metric_unproduced'))).toEqual([
      'metric_unproduced@/stages/0/columns/3',
      'metric_unproduced@/stages/0/rank/2/metric',
    ]);
  });

  it('lets a Swiss or round-robin stage produce Buchholz and refuses it for three players per match', () => {
    const swiss = mutate(classicLeague, [
      { op: 'replace', path: '/stages/0/columns', value: ['buchholz'] },
      { op: 'replace', path: '/stages/0/pairing', value: { kind: 'swiss', rounds: 'auto', avoid_repeats: true } },
    ]);
    expect(codesOf(swiss).some((c) => c.startsWith('metric_unproduced'))).toBe(false);
    const threeWay = mutate(classicLeague, [
      { op: 'replace', path: '/stages/0/columns', value: ['buchholz'] },
      { op: 'replace', path: '/stages/0/players_per_match', value: 3 },
    ]);
    expect(codesOf(threeWay, { ...CURRENT_ENV, matchModel: { ...CURRENT_ENV.matchModel, maxPlayersPerMatch: 3 } })).toContain(
      'metric_unproduced@/stages/0/columns/0',
    );
  });
});

describe('stage and edge checks', () => {
  it('rejects an even best of at the default and at the override level, with both fixes', () => {
    const def = compile(fixture('series-even-best-of').input).diagnostics.find((d) => d.code === 'series_even_best_of');
    expect(def?.fixes.map((f) => [f.id, f.params])).toEqual([
      ['use_lower_odd', { best_of: 1 }],
      ['use_higher_odd', { best_of: 3 }],
    ]);
    const over = compile(fixture('series-even-best-of-override').input).diagnostics.find((d) => d.code === 'series_even_best_of');
    expect(over?.json_pointer).toBe('/stages/1/series/overrides/0/best_of');
    expect(over?.fixes.map((f) => f.params.best_of)).toEqual([3, 5]);
  });

  it('offers no lower odd number below 1 and no higher one above 15', () => {
    const low = compile(mutate(classicLeague, [{ op: 'replace', path: '/stages/0/series/best_of', value: 2 }])).diagnostics;
    expect(low.find((d) => d.code === 'series_even_best_of')?.fixes).toHaveLength(2);
    const high = compile(mutate(classicLeague, [{ op: 'replace', path: '/stages/0/series/best_of', value: 14 }])).diagnostics;
    expect(high.find((d) => d.code === 'series_even_best_of')?.fixes.map((f) => f.params.best_of)).toEqual([13, 15]);
  });

  it('offers no fix for a decision match that appears twice, and none to reduce groups below two', () => {
    const twice = mutate(classicLeague, [
      { op: 'replace', path: '/stages/0/rank', value: [{ kind: 'decision_match' }, { kind: 'decision_match' }, { kind: 'metric', metric: 'points', direction: 'desc' }] },
    ]);
    const diagnostics = compile(twice).diagnostics.filter((d) => d.code === 'rank_decision_match_position');
    expect(diagnostics.map((d) => d.json_pointer)).toEqual(['/stages/0/rank/0', '/stages/0/rank/1']);
    expect(diagnostics.every((d) => d.fixes.length === 0)).toBe(true);
    const tiny = compile(cup, rosterEnv(3)).diagnostics.find((d) => d.code === 'groups_too_many');
    expect(tiny?.fixes).toEqual([]);
  });

  it('flags a decision match that is not the last rank step', () => {
    const f = fixture('rank-decision-match-position');
    expect(codesOf(f.input)).toContain('rank_decision_match_position@/stages/0/rank/1');
  });

  it('flags an empty rank chain on a table stage but not on an elimination stage', () => {
    expect(codesOf(fixture('rank-chain-empty').input)).toContain('rank_chain_empty@/stages/0/rank');
    expect(codesOf(classicLeague).some((c) => c.startsWith('rank_chain_empty'))).toBe(false);
  });

  it('asks for a group size of two before it counts groups', () => {
    const result = compile(cup, rosterEnv(6)).diagnostics;
    expect(result.some((d) => d.code === 'groups_too_many')).toBe(true);
    expect(result.some((d) => d.code === 'groups_uneven')).toBe(false);
  });

  it('reports a per-group selection on a stage without groups', () => {
    expect(codesOf(fixture('advance-per-group-without-groups').input)).toContain('advance_per_group_without_groups@/edges/0/select/0');
  });

  it('does not double-report a request that is too big as an overlap', () => {
    const codes = codesOf(fixture('advance-exceeds-source').input, rosterEnv(3));
    expect(codes).toContain('advance_exceeds_source@/edges/0/select/0');
    expect(codes.some((c) => c.startsWith('advance_overlap'))).toBe(false);
  });

  it('puts the byes of a roster-fed bracket on the pairing and of an edge-fed bracket on the edge', () => {
    expect(codesOf(fixture('advance-bracket-byes-edge').input, rosterEnv(12))).toContain('advance_bracket_byes@/edges/0');
    expect(codesOf(fixture('advance-bracket-byes-roster').input, rosterEnv(12))).toContain('advance_bracket_byes@/stages/0/pairing');
  });

  it('offers the wildcard fix only when the source stage has groups', () => {
    const withGroups = compile(fixture('advance-bracket-byes-edge').input, rosterEnv(12)).diagnostics.find((d) => d.code === 'advance_bracket_byes');
    expect(withGroups?.fixes.map((f) => f.id)).toEqual(['add_wildcard']);
    const without = mutate(classicLeague, [{ op: 'replace', path: '/edges/0/select/0/n', value: 3 }]);
    const plain = compile(without, rosterEnv(8)).diagnostics.find((d) => d.code === 'advance_bracket_byes');
    expect(plain?.params).toMatchObject({ incoming: 3, bracket_size: 4, byes: 1 });
    expect(plain?.fixes).toEqual([]);
  });
});

describe('swiss rounds against the field size', () => {
  const swissWith = (rounds: number | 'auto', avoidRepeats: boolean) =>
    mutate(swissTopCut, [{ op: 'replace', path: '/stages/0/pairing', value: { kind: 'swiss', rounds, avoid_repeats: avoidRepeats } }]);
  const warns = (input: unknown, players: number) =>
    compile(input, rosterEnv(players)).diagnostics.some((d) => d.code === 'swiss_rounds_too_many');

  it('warns when the rounds exceed what the field can play without repeats', () => {
    expect(warns(swissWith(6, true), 5)).toBe(true);
    expect(warns(swissWith(6, true), 6)).toBe(true);
    expect(warns(swissWith(12, true), 10)).toBe(true);
  });

  it('allows as many rounds as a round robin: n - 1 for an even field and n for an odd one', () => {
    expect(warns(swissWith(5, true), 5)).toBe(false);
    expect(warns(swissWith(5, true), 6)).toBe(false);
    expect(warns(swissWith(7, true), 8)).toBe(false);
    expect(warns(swissWith(8, true), 8)).toBe(true);
  });

  it('stays silent when the pairing may repeat anyway', () => {
    expect(warns(swissWith(12, false), 10)).toBe(false);
    expect(warns(swissWith(6, false), 5)).toBe(false);
  });
});

describe('threshold expressions', () => {
  it.each(NEGATIVE_FIXTURES.filter((f) => f.code.startsWith('expr_')).map((f) => [f.id, f] as const))(
    '%s surfaces at the pointer of the expression plus its own pointer',
    (_id, f) => {
      expect(f.pointer.startsWith('/edges/0/select/0/when')).toBe(true);
      const hit = fixtureDiagnostics(f).find((d) => d.code === f.code);
      expect(hit?.json_pointer).toBe(f.pointer);
      expect(hit?.params.edge).toBe('to_playoffs');
    },
  );

  it('reads the standings of the source stage, including the metrics it produces', () => {
    const when = {
      k: 'agg',
      fn: 'any',
      over: 'standings',
      where: { k: 'cmp', op: '>', a: { k: 'ref', name: 'item.kill_differential', t: 'number' }, b: { k: 'num', v: 0 } },
    };
    const input = mutate(classicLeague, [
      { op: 'replace', path: '/edges/0/select', value: [{ kind: 'threshold', when }] },
    ]);
    expect(compile(input, rosterEnv(8)).diagnostics).toEqual([]);
    const killOff = { ...CURRENT_ENV, rosterSize: 8, features: { killStats: false, rating: true } };
    expect(codesOf(input, killOff)).toContain('expr_unknown_field@/edges/0/select/0/when/where/a/name');
  });

  it('uses the roster size to bound the cost of an aggregate', () => {
    const f = fixture('expr-steps');
    expect(codesOf(f.input)).toContain('expr_steps@/edges/0/select/0/when');
    expect(codesOf(f.input, rosterEnv(8)).some((c) => c.startsWith('expr_steps'))).toBe(false);
  });
});

describe('fix catalog', () => {
  it('only the documented user-choice fixes may be empty', () => {
    expect(USER_CHOICE_FIXES).toEqual([]);
  });
});
