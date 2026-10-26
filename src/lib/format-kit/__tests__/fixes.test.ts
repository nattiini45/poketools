import { describe, expect, it } from 'vitest';
import { compile } from '../compile';
import { FIX_IDS, type Diagnostic } from '../engine/diagnostics';
import { CURRENT_ENV } from '../engine/env';
import { USER_CHOICE_FIXES } from '../engine/fixes';
import type { JsonValue } from '../patch';
import { applyPatch } from '../patch';
import { MAX_RANK_STEPS, MAX_SELECTS } from '../limits';
import { cup } from '../presets/cup';
import { classicLeague } from '../presets/classic-league';
import { mutate, NEGATIVE_FIXTURES, rosterEnv } from './fixtures/negative';

const key = (d: Diagnostic) => `${d.code}@${d.json_pointer}`;
const errorKeys = (diagnostics: readonly Diagnostic[]) => diagnostics.filter((d) => d.severity === 'error').map(key);

/** Fixtures the compiler can run end to end, with the diagnostics that carry fixes. */
const WITH_FIXES = NEGATIVE_FIXTURES.flatMap((fixture) => {
  if (fixture.engineOnly) return [];
  const env = fixture.env ?? CURRENT_ENV;
  const hits = compile(fixture.input, env).diagnostics.filter(
    (d) => d.code === fixture.code && d.json_pointer === fixture.pointer && d.fixes.length > 0,
  );
  return hits.map((hit) => ({ fixture, env, hit }));
});

describe('fixes', () => {
  it('covers every fix id with at least one fixture', () => {
    const covered = new Set(WITH_FIXES.flatMap(({ hit }) => hit.fixes.map((f) => f.id)));
    expect([...FIX_IDS].filter((id) => !covered.has(id))).toEqual([]);
  });

  it('never carries an empty patch outside the documented user-choice set', () => {
    for (const { fixture, hit } of WITH_FIXES) {
      for (const fix of hit.fixes) {
        if (USER_CHOICE_FIXES.includes(fix.id)) continue;
        expect(fix.patch.length, `${fixture.id} ${fix.id}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(WITH_FIXES.flatMap(({ fixture, env, hit }) => hit.fixes.map((fix) => [`${fixture.id} / ${fix.id}`, fixture, env, hit, fix] as const)))(
    '%s removes its diagnostic and adds no error',
    (_name, fixture, env, hit, fix) => {
      const applied = applyPatch(fixture.input as JsonValue, fix.patch);
      expect(applied.ok, applied.ok ? '' : `patch failed: ${applied.reason}`).toBe(true);
      if (!applied.ok) return;

      const before = compile(fixture.input, env);
      const after = compile(applied.value, env);
      expect(after.diagnostics.map(key)).not.toContain(key(hit));
      expect(errorKeys(after.diagnostics).filter((k) => !errorKeys(before.diagnostics).includes(k))).toEqual([]);
      // The fixed document is still a valid document.
      expect(after.definition).not.toBeNull();
    },
  );

  it('does not change the document it is built from', () => {
    for (const { fixture, hit } of WITH_FIXES.slice(0, 5)) {
      const snapshot = JSON.stringify(fixture.input);
      for (const fix of hit.fixes) applyPatch(fixture.input as JsonValue, fix.patch);
      expect(JSON.stringify(fixture.input)).toBe(snapshot);
    }
  });

  it('builds the patches the catalog promises', () => {
    const patchOf = (id: string, fixId: string) => {
      const fixture = NEGATIVE_FIXTURES.find((f) => f.id === id);
      const hit = fixture && compile(fixture.input, fixture.env ?? CURRENT_ENV).diagnostics.find((d) => d.code === fixture.code && d.json_pointer === fixture.pointer);
      return hit?.fixes.find((f) => f.id === fixId)?.patch;
    };
    expect(patchOf('series-even-best-of', 'use_lower_odd')).toEqual([{ op: 'replace', path: '/stages/0/series/best_of', value: 1 }]);
    expect(patchOf('advance-bracket-byes-edge', 'add_wildcard')).toEqual([
      { op: 'add', path: '/edges/0/select/-', value: { kind: 'wildcard', n: 2 } },
    ]);
    expect(patchOf('rank-decision-match-position', 'move_decision_match_last')).toEqual([
      { op: 'remove', path: '/stages/0/rank/1' },
      { op: 'add', path: '/stages/0/rank/-', value: { kind: 'decision_match' } },
    ]);
    expect(patchOf('groups-too-many', 'reduce_groups')).toEqual([{ op: 'replace', path: '/stages/0/groups/count', value: 3 }]);
    expect(patchOf('draws-series', 'remove_draw')).toEqual([{ op: 'replace', path: '/stages/0/series/allow_draw', value: false }]);
  });

  it('also works on a stored document that leaves the defaulted fields out', () => {
    const stored = {
      schema_version: 1,
      identity: { name: { base: 'en', en: { v: 'Cup', s: 'human' } } },
      stages: [
        {
          key: 'league',
          name: { base: 'en', en: { v: 'League', s: 'human' } },
          participants: { from: 'roster', seeding: 'signup' },
          pairing: { kind: 'round_robin' },
          series: { best_of: 1 },
          scoring: { win: 3 },
        },
      ],
    };
    const result = compile(stored);
    const empty = result.diagnostics.find((d) => d.code === 'rank_chain_empty');
    expect(empty?.fixes[0].id).toBe('add_points_step');
    const applied = applyPatch(stored as JsonValue, empty?.fixes[0].patch ?? []);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(compile(applied.value).diagnostics.map((d) => d.code)).not.toContain('rank_chain_empty');
  });
});

describe('fixes at the limits of the document', () => {
  const metricStep = (metric: string) => ({ kind: 'metric', metric, direction: 'desc' });
  const diagnosticOf = (input: unknown, code: string, env = CURRENT_ENV) => compile(input, env).diagnostics.find((d) => d.code === code);

  function appliedErrors(input: unknown, fix: { patch: Parameters<typeof applyPatch>[1] }, env = CURRENT_ENV) {
    const applied = applyPatch(input as JsonValue, fix.patch);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return [];
    const after = compile(applied.value, env);
    expect(after.definition).not.toBeNull();
    return errorKeys(after.diagnostics);
  }

  it('offers no rank step removal when it would leave an empty chain', () => {
    const only = mutate(classicLeague, [{ op: 'replace', path: '/stages/0/rank', value: [metricStep('mystery')] }]);
    expect(diagnosticOf(only, 'metric_unproduced')?.fixes).toEqual([]);
    // With a second step the removal is still offered, and the result has no new error.
    const two = mutate(classicLeague, [{ op: 'replace', path: '/stages/0/rank', value: [metricStep('mystery'), metricStep('points'), { kind: 'coin_flip' }] }]);
    const hit = diagnosticOf(two, 'metric_unproduced');
    expect(hit?.fixes.map((f) => f.id)).toEqual(['remove_rank_step']);
    expect(appliedErrors(two, hit?.fixes[0] as never)).toEqual([]);
  });

  it('offers a coin flip only while the chain is below its length limit', () => {
    const chain = (n: number) => mutate(classicLeague, [{ op: 'replace', path: '/stages/0/rank', value: Array.from({ length: n }, () => metricStep('points')) }]);
    const full = diagnosticOf(chain(MAX_RANK_STEPS), 'rank_open_ended');
    expect(full).toBeDefined();
    expect(full?.fixes).toEqual([]);
    const room = diagnosticOf(chain(MAX_RANK_STEPS - 1), 'rank_open_ended');
    expect(room?.fixes.map((f) => f.id)).toEqual(['add_coin_flip']);
    expect(appliedErrors(chain(MAX_RANK_STEPS - 1), room?.fixes[0] as never)).toEqual([]);
  });

  it('offers wildcard spots only while the edge has room for another selection', () => {
    const edgeWith = (selects: number) =>
      mutate(cup, [
        { op: 'replace', path: '/stages/0/groups/count', value: 3 },
        {
          op: 'replace',
          path: '/edges/0/select',
          value: [{ kind: 'per_group', n: 1 }, ...Array.from({ length: selects - 1 }, () => ({ kind: 'top_n', n: 1 }))],
        },
      ]);
    const full = diagnosticOf(edgeWith(MAX_SELECTS), 'advance_bracket_byes', rosterEnv(12));
    expect(full?.params.edge).toBe('to_knockout');
    expect(full?.fixes).toEqual([]);
    const room = diagnosticOf(edgeWith(MAX_SELECTS - 1), 'advance_bracket_byes', rosterEnv(12));
    expect(room?.fixes.map((f) => f.id)).toEqual(['add_wildcard']);
    expect(appliedErrors(edgeWith(MAX_SELECTS - 1), room?.fixes[0] as never, rosterEnv(12))).toEqual([]);
  });
});
