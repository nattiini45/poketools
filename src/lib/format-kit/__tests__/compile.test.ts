import { describe, expect, it } from 'vitest';
import { compile } from '../compile';
import { sortDiagnostics, type Diagnostic } from '../engine/diagnostics';
import { CURRENT_ENV } from '../engine/env';
import { contentHash } from '@/lib/studio-core/json';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import { PRESETS } from '../presets';
import { swissTopCut } from '../presets/swiss-top-cut';
import type { FormatDefinition } from '../types';
import { fixtureDiagnostics, mutate, NEGATIVE_FIXTURES, rosterEnv } from './fixtures/negative';

const errors = (list: readonly Diagnostic[]) => list.filter((d) => d.severity === 'error');

describe('presets', () => {
  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('%s compiles cleanly without a roster size', (_id, def) => {
    const result = compile(def);
    expect(result.ok).toBe(true);
    expect(errors(result.diagnostics)).toEqual([]);
    expect(result.diagnostics.every((d) => d.severity === 'info')).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('participant_count_unknown');
  });

  it.each([
    ['classic league', classicLeague, 8],
    ['cup', cup, 16],
    ['swiss with top cut', swissTopCut, 32],
  ] as const)('%s has no errors and no warnings for a roster of %i', (_name, def, size) => {
    const result = compile(def, rosterEnv(size));
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.plan).not.toBeNull();
  });

  it('keeps the parsed definition equal to the preset and hashes it', () => {
    for (const { definition } of PRESETS) {
      const result = compile(definition);
      expect(result.definition).toEqual(definition);
      expect(result.hash).toBe(contentHash(definition));
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('plans the cup: 4 groups of 4, 8 qualify, bracket of 8 without byes', () => {
    const plan = compile(cup, rosterEnv(16)).plan;
    expect(plan?.find((p) => p.key === 'groups')).toMatchObject({ participants: { min: 16, max: 16 }, groupSize: { min: 4, max: 4 } });
    expect(plan?.find((p) => p.key === 'knockout')).toMatchObject({ bracketSize: 8, byes: 0 });
  });
});

describe('negative fixtures', () => {
  it.each(NEGATIVE_FIXTURES.map((f) => [f.id, f] as const))('%s yields its diagnostic', (_id, fixture) => {
    const found = fixtureDiagnostics(fixture).filter((d) => d.code === fixture.code && d.json_pointer === fixture.pointer);
    expect(found, `${fixture.code} at ${fixture.pointer}`).not.toHaveLength(0);
    const [first] = found;
    expect(first.severity).toBe(fixture.severity);
    if (fixture.params !== undefined) expect(first.params).toMatchObject(fixture.params);
  });

  it('sets ok to false exactly when an error exists', () => {
    for (const fixture of NEGATIVE_FIXTURES.filter((f) => !f.engineOnly)) {
      const result = compile(fixture.input, fixture.env ?? CURRENT_ENV);
      expect(result.ok, fixture.id).toBe(errors(result.diagnostics).length === 0);
    }
  });

  it('yields only schema diagnostics and no definition for an invalid document', () => {
    for (const fixture of NEGATIVE_FIXTURES.filter((f) => f.code.startsWith('schema_'))) {
      const result = compile(fixture.input);
      expect(result.ok, fixture.id).toBe(false);
      expect(result.definition, fixture.id).toBeNull();
      expect(result.hash, fixture.id).toBeNull();
      expect(result.capabilities, fixture.id).toBeNull();
      expect(result.graph, fixture.id).toBeNull();
      expect(result.plan, fixture.id).toBeNull();
      expect(result.diagnostics.length, fixture.id).toBeGreaterThan(0);
      expect(result.diagnostics.every((d) => d.code.startsWith('schema_')), fixture.id).toBe(true);
    }
  });

  it('keeps a document with an unknown rule kind as a manual card and a warning', () => {
    const input = mutate(classicLeague, [{ op: 'add', path: '/rules/-', value: { kind: 'custom.mystery', id: 'mystery' } }]);
    const result = compile(input);
    expect(result.ok).toBe(true);
    const warning = result.diagnostics.find((d) => d.code === 'rule_unknown_primitive');
    expect(warning).toMatchObject({ severity: 'warning', json_pointer: '/rules/1', params: { kind: 'custom.mystery' } });
    expect(result.definition?.rules[1]).toMatchObject({ kind: 'rule.custom', id: 'mystery', degraded_from: 'custom.mystery' });
  });

  it('reports a reserved section as not available yet and nothing else for it', () => {
    const result = compile(mutate(classicLeague, [{ op: 'add', path: '/attributes', value: [{ key: 'tera' }] }]));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'schema_not_available_yet', json_pointer: '/attributes', params: { what: 'attributes' } });
  });
});

describe('result shape', () => {
  it('sorts diagnostics by severity, pointer and code', () => {
    const input = mutate(classicLeague, [
      { op: 'replace', path: '/stages/0/series/best_of', value: 2 },
      { op: 'replace', path: '/stages/0/scoring/win', value: 0 },
      { op: 'replace', path: '/stages/0/players_per_match', value: 3 },
      { op: 'replace', path: '/stages/0/rank', value: [] },
      { op: 'replace', path: '/stages/1/rank', value: [{ kind: 'coin_flip' }] },
    ]);
    const { diagnostics } = compile(input);
    expect(diagnostics.length).toBeGreaterThan(4);
    expect(diagnostics).toEqual(sortDiagnostics(diagnostics));
    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < diagnostics.length; i += 1) {
      const a = diagnostics[i - 1];
      const b = diagnostics[i];
      expect(rank[a.severity]).toBeLessThanOrEqual(rank[b.severity]);
      if (a.severity === b.severity) expect(a.json_pointer <= b.json_pointer).toBe(true);
    }
  });

  it('deep-freezes the result', () => {
    const result = compile(classicLeague, rosterEnv(8));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.definition)).toBe(true);
    expect(Object.isFrozen(result.definition?.stages[0])).toBe(true);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.graph?.nodes[0])).toBe(true);
    expect(Object.isFrozen(result.capabilities)).toBe(true);
    const failing = compile(NEGATIVE_FIXTURES[0].input);
    expect(Object.isFrozen(failing)).toBe(true);
    expect(Object.isFrozen(failing.diagnostics[0])).toBe(true);
  });

  it('does not freeze or change the input', () => {
    const input = JSON.parse(JSON.stringify(classicLeague)) as FormatDefinition;
    const before = JSON.stringify(input);
    compile(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.stages)).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('holds codes and params only, never localized text', () => {
    const result = compile(NEGATIVE_FIXTURES.find((f) => f.code === 'advance_bracket_byes')?.input, rosterEnv(12));
    for (const d of result.diagnostics) {
      expect(Object.keys(d).sort()).toEqual(['code', 'fixes', 'json_pointer', 'params', 'severity']);
      for (const value of Object.values(d.params)) expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });
});

describe('hostile input', () => {
  const deepArray = (() => {
    let node: unknown[] = [];
    for (let i = 0; i < 1_000_000; i += 1) node = [node];
    return node;
  })();
  const cyclic: Record<string, unknown> = { schema_version: 1 };
  cyclic.self = cyclic;
  const big = { ...JSON.parse(JSON.stringify(classicLeague)), pad: 'x'.repeat(300_000) } as unknown;

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'str'],
    ['a number', 5],
    ['an empty array', []],
    ['a Map', new Map()],
    ['a cyclic object', cyclic],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['NaN inside a document', { schema_version: Number.NaN }],
    ['a NUL character', mutate(classicLeague, [{ op: 'replace', path: '/identity/name/en/v', value: 'a\u0000b' }])],
  ])('does not throw for %s', (_name, input) => {
    const result = compile(input);
    expect(result.ok).toBe(false);
    expect(result.definition).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.code.startsWith('schema_'))).toBe(true);
  });

  it('rejects a million-deep array without recursing', () => {
    const result = compile(deepArray);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['schema_limit']);
    expect(result.diagnostics[0].params).toMatchObject({ limit: 'depth' });
  });

  it('rejects a 300 KB document by size', () => {
    const result = compile(big);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['schema_limit']);
    expect(result.diagnostics[0].params).toMatchObject({ limit: 'body_bytes' });
  });

  it('reports a value that is not JSON as a type issue', () => {
    expect(compile(undefined).diagnostics).toMatchObject([{ code: 'schema_type', params: { limit: 'not_json' } }]);
  });

  it('treats an own __proto__ key as ordinary data and leaves Object.prototype alone', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"schema_version":1}') as unknown;
    const result = compile(polluted);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'schema_unknown_key')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
