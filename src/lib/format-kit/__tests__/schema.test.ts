import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_ISSUES,
  finalizeIssues,
  mapZodIssues,
  sortIssues,
  sortNotes,
  toPointer,
  type SchemaIssue,
  type ValidationResult,
} from '../issues';
import { canonicalizeJson, inspectJson, utf8ByteLength } from '@/lib/studio-core/json';
import { MAX_BODY_BYTES } from '../limits';
import { formatDefinitionSchema, type SchemaMatchesTypes } from '../schema';
import type { FormatDefinition } from '../types';
import { validateFormatDefinition } from '../validate';
import {
  VALID_DOCS,
  cupDoc,
  degradedRulesDoc,
  kitchenSinkDoc,
  lt,
  minimalDoc,
  minimalDocValidated,
  swissDoc,
  type Json,
} from './fixtures/docs';
import { COMPILE_ONLY_CASES, INVALID_CASES, clone, deleteAt, setAt } from './fixtures/invalid';

// Compile-time: the zod output equals the hand-written types (see schema/index.ts). The alias is
// referenced here so tsc fails this file if the assertion tuple stops compiling.
export type ProofOfTypeEquality = SchemaMatchesTypes;

function expectInvalid(input: unknown): SchemaIssue[] {
  const result = validateFormatDefinition(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues;
}

function expectValid(input: unknown): Extract<ValidationResult, { ok: true }> {
  const result = validateFormatDefinition(input);
  if (!result.ok) throw new Error(`expected a valid document, got ${JSON.stringify(result.issues)}`);
  return result;
}

const codes = (issues: SchemaIssue[]) => issues.map((issue) => `${issue.code} ${issue.pointer}`);

describe('defaults and normalisation', () => {
  it('parses the minimal document and fills every default', () => {
    const result = expectValid(minimalDoc());
    expect(result.value).toEqual(minimalDocValidated());
    expect(result.notes).toEqual([]);
  });

  it('keeps explicit values over defaults', () => {
    const result = expectValid(kitchenSinkDoc());
    const stage = result.value.stages[0];
    expect(stage.pairing).toEqual({ kind: 'round_robin', legs: 3, mirror_legs: false });
    expect(stage.players_per_match).toBe(2);
    expect(result.value.theme).toEqual({ world: 'forest' });
  });

  it('accepts every valid fixture and never changes its input', () => {
    for (const { id, build } of VALID_DOCS) {
      const input = build();
      const before = canonicalizeJson(input);
      expect(validateFormatDefinition(input).ok, id).toBe(true);
      expect(canonicalizeJson(input), id).toBe(before);
    }
  });

  it('accepts what only the compiler rejects', () => {
    for (const { id, build } of COMPILE_ONLY_CASES) {
      expect(validateFormatDefinition(build()).ok, id).toBe(true);
    }
  });

  it('gives each parse fresh default objects', () => {
    const a = expectValid(minimalDoc()).value;
    const b = expectValid(minimalDoc()).value;
    a.stages[0].series.overrides.push({ round: 1, from: 'start', best_of: 3 });
    a.stages[0].ruleset = { kind: 'ruleset', id: 'changed' };
    a.text.sections.push({ id: 'x', title: lt('t') as never, body: lt('b') as never });
    a.theme.world = 'changed';
    expect(b.stages[0].series.overrides).toEqual([]);
    expect(b.stages[0].ruleset).toEqual({ kind: 'season_default' });
    expect(b.text.sections).toEqual([]);
    expect(b.theme.world).toBe('auto');
    expect(expectValid(minimalDoc()).value.text.sections).toEqual([]);
  });

  it('is deterministic', () => {
    const first = canonicalizeJson(expectValid(kitchenSinkDoc()).value);
    expect(canonicalizeJson(expectValid(kitchenSinkDoc()).value)).toBe(first);
  });

  it('keeps a user key named like an Object.prototype member as plain data', () => {
    const doc = setAt(minimalDoc(), ['stages', 0, 'key'], 'constructor');
    const result = expectValid(doc);
    expect(result.value.stages[0].key).toBe('constructor');
    const withToString = setAt(minimalDoc(), ['stages', 0, 'columns'], ['valueof', 'prototype']);
    expect(expectValid(withToString).value.stages[0].columns).toEqual(['valueof', 'prototype']);
  });
});

describe('limit boundaries', () => {
  const stages = (count: number): Json => {
    const doc = minimalDoc();
    const stage = (doc.stages as Json[])[0];
    doc.stages = Array.from({ length: count }, (_, i) => ({ ...clone(stage), key: `stage_${i}` }));
    return doc;
  };
  const rules = (count: number): Json => setAt(minimalDoc(), ['rules'], Array.from({ length: count }, (_, i) => ({ kind: 'rule.custom', id: `rule_${i}`, text: lt('Rule') })));
  const edges = (count: number): Json =>
    setAt(minimalDoc(), ['edges'], Array.from({ length: count }, (_, i) => ({ key: `edge_${i}`, from: 'a', to: 'b', select: [{ kind: 'top_n', n: 1 }] })));

  it('stages: 50 pass, 51 and 0 fail', () => {
    expect(validateFormatDefinition(stages(50)).ok).toBe(true);
    expect(codes(expectInvalid(stages(51)))).toEqual(['length /stages']);
    expect(codes(expectInvalid(stages(0)))).toEqual(['length /stages']);
  });

  it('rules: 200 pass, 201 fail', () => {
    expect(validateFormatDefinition(rules(200)).ok).toBe(true);
    expect(codes(expectInvalid(rules(201)))).toEqual(['length /rules']);
  });

  it('edges: 100 pass, 101 fail', () => {
    expect(validateFormatDefinition(edges(100)).ok).toBe(true);
    expect(codes(expectInvalid(edges(101)))).toEqual(['length /edges']);
  });

  it('text sections 32/33, views 8/9', () => {
    const sections = (n: number) =>
      setAt(minimalDoc(), ['text'], { sections: Array.from({ length: n }, (_, i) => ({ id: `s_${i}`, title: lt('T'), body: lt('B') })) });
    expect(validateFormatDefinition(sections(32)).ok).toBe(true);
    expect(codes(expectInvalid(sections(33)))).toEqual(['length /text/sections']);
    const views = (n: number) =>
      setAt(minimalDoc(), ['views'], Array.from({ length: n }, (_, i) => ({ key: `v_${i}`, label: lt('V'), stages: ['a', 'b'], metric: 'points', combine: 'sum' })));
    expect(validateFormatDefinition(views(8)).ok).toBe(true);
    expect(codes(expectInvalid(views(9)))).toEqual(['length /views']);
  });

  it('key length: 32 passes, 33 fails', () => {
    expect(validateFormatDefinition(setAt(minimalDoc(), ['stages', 0, 'key'], 'a'.repeat(32))).ok).toBe(true);
    expect(codes(expectInvalid(setAt(minimalDoc(), ['stages', 0, 'key'], 'a'.repeat(33))))).toEqual(['pattern /stages/0/key']);
    expect(validateFormatDefinition(setAt(minimalDoc(), ['stages', 0, 'key'], 'a')).ok).toBe(true);
  });

  const range = (build: (n: unknown) => unknown, pointer: string, accepted: number[], rejected: unknown[]) => {
    for (const n of accepted) expect(validateFormatDefinition(build(n)).ok, `${pointer} = ${n}`).toBe(true);
    for (const n of rejected) {
      const issues = expectInvalid(build(n));
      expect(issues.map((i) => i.pointer), `${pointer} = ${String(n)}`).toEqual([pointer]);
    }
  };

  it('groups.count 2..26', () => {
    range((n) => setAt(cupDoc(), ['stages', 0, 'groups', 'count'], n), '/stages/0/groups/count', [2, 26], [1, 27]);
  });
  it('best_of 1..15 integers', () => {
    range((n) => setAt(minimalDoc(), ['stages', 0, 'series', 'best_of'], n), '/stages/0/series/best_of', [1, 15], [0, 16, 2.5]);
  });
  it('legs 1..4', () => {
    range((n) => setAt(minimalDoc(), ['stages', 0, 'pairing', 'legs'], n), '/stages/0/pairing/legs', [1, 4], [0, 5]);
  });
  it('players_per_match 2..8', () => {
    range((n) => setAt(minimalDoc(), ['stages', 0, 'players_per_match'], n), '/stages/0/players_per_match', [2, 8], [1, 9]);
  });
  it('select entries 1..4, rank steps 0..12, columns 0..12, overrides 0..32', () => {
    const list = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));
    range((n) => setAt(cupDoc(), ['edges', 0, 'select'], list(n as number, () => ({ kind: 'top_n', n: 1 }))), '/edges/0/select', [1, 4], [0, 5]);
    range((n) => setAt(minimalDoc(), ['stages', 0, 'rank'], list(n as number, () => ({ kind: 'coin_flip' }))), '/stages/0/rank', [0, 12], [13]);
    range((n) => setAt(minimalDoc(), ['stages', 0, 'columns'], list(n as number, (i) => `c_${i}`)), '/stages/0/columns', [0, 12], [13]);
    range(
      (n) => setAt(minimalDoc(), ['stages', 0, 'series', 'overrides'], list(n as number, (i) => ({ round: i + 1, best_of: 3 }))),
      '/stages/0/series/overrides',
      [0, 32],
      [33],
    );
  });
  it('modules 0..3, facts 0..64', () => {
    const mod = (facts: number) => ({
      kind: 'module.legacy',
      adapter: 'epb',
      facts: Array.from({ length: facts }, (_, i) => ({ key: `f_${i}`, label: lt('F'), value: i })),
    });
    range((n) => setAt(minimalDoc(), ['modules'], Array.from({ length: n as number }, () => mod(0))), '/modules', [0, 3], [4]);
    range((n) => setAt(minimalDoc(), ['modules'], [mod(n as number)]), '/modules/0/facts', [0, 64], [65]);
  });
  it('n bounds and swiss rounds', () => {
    range((n) => setAt(cupDoc(), ['edges', 0, 'select'], [{ kind: 'top_n', n }]), '/edges/0/select/0/n', [1, 1024], [0, 1025]);
    range((n) => setAt(cupDoc(), ['edges', 0, 'select', 0, 'n'], n), '/edges/0/select/0/n', [1, 64], [0, 65]);
    range((n) => setAt(swissDoc(), ['stages', 0, 'pairing', 'rounds'], n), '/stages/0/pairing/rounds', [1, 32], [0, 33]);
  });
  it('LText values 1..4000 characters', () => {
    const name = (v: string) => setAt(minimalDoc(), ['identity', 'name', 'en', 'v'], v);
    expect(validateFormatDefinition(name('x'.repeat(4000))).ok).toBe(true);
    expect(codes(expectInvalid(name('x'.repeat(4001))))).toEqual(['length /identity/name/en/v']);
    expect(codes(expectInvalid(name('')))).toEqual(['length /identity/name/en/v']);
  });
  it('scoring within +-1000', () => {
    range((n) => setAt(minimalDoc(), ['stages', 0, 'scoring', 'win'], n), '/stages/0/scoring/win', [-1000, 1000, 0.5], [1001, -1001]);
  });

  it('body size: the 256 KB boundary is measured in UTF-8 bytes of the JSON', () => {
    // 64 three-byte texts of L characters each: valid by every per-field limit, large in bytes.
    const padded = (length: number): Json =>
      setAt(minimalDoc(), ['text'], {
        sections: Array.from({ length: 32 }, (_, i) => ({ id: `s_${i}`, title: lt('€'.repeat(length)), body: lt('€'.repeat(length)) })),
      });
    let lo = 1;
    let hi = 4000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (inspectJson(padded(mid)).ok) lo = mid;
      else hi = mid - 1;
    }
    expect(lo).toBeLessThan(4000);
    const fits = inspectJson(padded(lo));
    expect(fits.ok && fits.bytes <= MAX_BODY_BYTES).toBe(true);
    expect(validateFormatDefinition(padded(lo)).ok).toBe(true);

    const over = expectInvalid(padded(lo + 1));
    expect(over).toHaveLength(1);
    expect(over[0].code).toBe('limit');
    expect(over[0].params).toEqual({ limit: 'body_bytes' });
    expect(utf8ByteLength(JSON.stringify(padded(lo + 1)))).toBeGreaterThan(MAX_BODY_BYTES);
  });

  it('a 300 KB body is a limit issue before any structural parsing', () => {
    const huge = { schema_version: 1, filler: 'x'.repeat(300_000) };
    const issues = expectInvalid(huge);
    expect(issues).toEqual([{ code: 'limit', pointer: '/filler', params: { limit: 'body_bytes' } }]);
  });

  it('too many nodes is a limit issue', () => {
    const wide = { schema_version: 1, stages: Array.from({ length: 160_000 }, () => 0) };
    const issues = expectInvalid(wide);
    expect(issues).toHaveLength(1);
    expect(issues[0].params).toEqual({ limit: 'nodes' });
  });

  it('too deep is a limit issue, non-JSON values are a type issue', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i += 1) deep = [deep];
    const deepIssues = expectInvalid(deep);
    expect(deepIssues[0]).toMatchObject({ code: 'limit', params: { limit: 'depth' } });
    const notJson = expectInvalid({ schema_version: 1, when: new Map() });
    expect(notJson[0]).toMatchObject({ code: 'type', params: { limit: 'not_json' } });
    expect(expectInvalid(undefined)[0]).toMatchObject({ code: 'type', params: { limit: 'not_json' } });
  });
});

describe('strictness', () => {
  function objectPointers(value: unknown, pointer = '', out: string[] = []): string[] {
    if (Array.isArray(value)) {
      value.forEach((item, i) => objectPointers(item, `${pointer}/${i}`, out));
    } else if (typeof value === 'object' && value !== null) {
      out.push(pointer);
      for (const key of Object.keys(value)) objectPointers((value as Record<string, unknown>)[key], `${pointer}/${key}`, out);
    }
    return out;
  }

  it('an extra key at EVERY object level is an unknown_key (and nothing else)', () => {
    for (const { id, build } of VALID_DOCS) {
      if (id === 'degraded-rules') continue;
      const pointers = objectPointers(build());
      expect(pointers.length, id).toBeGreaterThan(5);
      for (const pointer of pointers) {
        const doc = build();
        const steps = pointer === '' ? [] : pointer.slice(1).split('/').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
        let node: Record<string, unknown> = doc;
        for (const step of steps) node = node[step as string] as Record<string, unknown>;
        node.zz_extra = 1;
        const issues = expectInvalid(doc);
        expect(codes(issues), `${id} ${pointer}`).toEqual([`unknown_key ${pointer}/zz_extra`]);
      }
    }
  });

  it('an own __proto__ key from JSON.parse is rejected as data and never pollutes', () => {
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const evil = JSON.parse('{"__proto__":{"polluted":true},"schema_version":1}') as unknown;
    const first = expectInvalid(evil);
    expect(first).toContainEqual({ code: 'unknown_key', pointer: '/__proto__', params: {} });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const nested = JSON.parse(JSON.stringify(minimalDoc())) as Json;
    (nested.stages as Json[])[0].scoring = JSON.parse('{"win":3,"__proto__":{"polluted":true}}');
    expect(codes(expectInvalid(nested))).toEqual(['unknown_key /stages/0/scoring/__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('reports at most 100 unknown keys of one object', () => {
    const doc: Json = minimalDoc();
    for (let i = 0; i < 5000; i += 1) doc[`junk_${i}`] = i;
    const issues = expectInvalid(doc);
    expect(issues).toHaveLength(MAX_ISSUES);
    expect(issues.every((issue) => issue.code === 'unknown_key')).toBe(true);
  });
});

describe('reserved sections and kinds', () => {
  it('every reserved top-level section is not_available_yet and nothing else', () => {
    for (const name of ['attributes', 'domains', 'relations', 'resources', 'metrics', 'tunables']) {
      for (const content of [{}, [], null, { deep: { deeper: [1, 2] } }]) {
        const issues = expectInvalid({ ...minimalDoc(), [name]: content });
        expect(issues, name).toEqual([{ code: 'not_available_yet', pointer: `/${name}`, params: { what: name } }]);
      }
    }
  });

  it('every reserved stage field', () => {
    for (const name of ['constraints', 'acquire', 'calendar', 'end_when', 'foreach_group']) {
      const issues = expectInvalid(setAt(minimalDoc(), ['stages', 0, name], { anything: [1] }));
      expect(issues).toEqual([{ code: 'not_available_yet', pointer: `/stages/0/${name}`, params: { what: name } }]);
    }
  });

  it('every reserved pairing kind', () => {
    for (const tag of ['bipartite', 'filter', 'challenge']) {
      const issues = expectInvalid(setAt(minimalDoc(), ['stages', 0, 'pairing'], { kind: tag, junk: true }));
      expect(issues).toEqual([{ code: 'not_available_yet', pointer: '/stages/0/pairing', params: { what: `pairing.${tag}` } }]);
    }
  });

  it('every reserved rule kind, with the other rules still validated', () => {
    for (const kind of ['rule.on_event', 'player.action', 'check.assisted', 'adjust.manual']) {
      const doc = setAt(minimalDoc(), ['rules'], [{ kind: 'rule.custom', id: 'ok', text: lt('Fine') }, { kind, whatever: 1 }, { kind: 'rule.custom' }]);
      const issues = expectInvalid(doc);
      expect(issues).toContainEqual({ code: 'not_available_yet', pointer: '/rules/1', params: { what: kind } });
      expect(codes(issues)).toContain('required /rules/2/id');
      expect(codes(issues).filter((c) => c.includes('/rules/1'))).toEqual([`not_available_yet /rules/1`]);
    }
  });

  it('other parts of the document are still validated next to a reserved section', () => {
    const doc = { ...setAt(minimalDoc(), ['stages', 0, 'series', 'best_of'], 0), attributes: {} };
    expect(codes(expectInvalid(doc))).toEqual(['not_available_yet /attributes', 'range /stages/0/series/best_of']);
  });
});

describe('unknown rule kinds degrade to manual rule cards', () => {
  it('turns an unknown kind into a rule.custom with degraded_from and a note', () => {
    const result = expectValid(degradedRulesDoc());
    expect(result.value.rules).toHaveLength(2);
    expect(result.value.rules[0]).toEqual({
      kind: 'rule.custom',
      id: 'first',
      text: { base: 'en', en: { v: 'rule.unknown_one', s: 'machine' } },
      scope: { kind: 'season' },
      verify: 'admin_checklist',
      when: 'once',
      visible_to_players: true,
      degraded_from: 'rule.unknown_one',
    });
    expect(result.notes).toEqual([
      { code: 'unknown_primitive', pointer: '/rules/0', params: { kind: 'rule.unknown_one' } },
      { code: 'unknown_primitive', pointer: '/rules/1', params: { kind: 'rule.unknown_two' } },
    ]);
  });

  it('keeps the entry text when it is valid and drops every other key unread', () => {
    const result = expectValid(degradedRulesDoc());
    expect(result.value.rules[1]).toMatchObject({
      id: 'second',
      text: lt('Keep me', 'Behalte mich'),
      degraded_from: 'rule.unknown_two',
    });
    expect(JSON.stringify(result.value.rules[1])).not.toContain('deep');
  });

  it('falls back to the machine text of the kind when the entry text is invalid', () => {
    const doc = setAt(minimalDoc(), ['rules'], [{ kind: 'rule.future', id: 'x', text: { base: 'de' } }]);
    expect(expectValid(doc).value.rules[0].text).toEqual({ base: 'en', en: { v: 'rule.future', s: 'machine' } });
  });

  it('does not read hostile keys of a degraded entry', () => {
    const entry = JSON.parse('{"kind":"rule.future","id":"x","__proto__":{"polluted":1},"constructor":"x"}') as unknown;
    const result = expectValid(setAt(minimalDoc(), ['rules'], [entry]));
    expect(Object.keys(result.value.rules[0]).sort()).toEqual(
      ['degraded_from', 'id', 'kind', 'scope', 'text', 'verify', 'visible_to_players', 'when'].sort(),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a known rule card with its own degraded_from', () => {
    const doc = setAt(minimalDoc(), ['rules'], [{ kind: 'rule.custom', id: 'x', text: lt('T'), degraded_from: 'rule.old' }]);
    const result = expectValid(doc);
    expect(result.value.rules[0].degraded_from).toBe('rule.old');
    expect(result.notes).toEqual([]);
  });

  it('a kind that is not a string, or is malformed, is a normal issue', () => {
    expect(codes(expectInvalid(setAt(minimalDoc(), ['rules'], [{ kind: 5 }])))).toEqual(['type /rules/0/kind']);
    expect(codes(expectInvalid(setAt(minimalDoc(), ['rules'], [{ kind: 'Not a kind' }])))).toEqual(['pattern /rules/0/kind']);
    expect(codes(expectInvalid(setAt(minimalDoc(), ['rules'], [{}])))).toEqual(['required /rules/0/kind']);
  });
});

describe('edge cases of the document', () => {
  it('schema_version', () => {
    expect(codes(expectInvalid(deleteAt(minimalDoc(), ['schema_version'])))).toEqual(['required /schema_version']);
    expect(codes(expectInvalid(setAt(minimalDoc(), ['schema_version'], 2)))).toEqual(['enum /schema_version']);
  });

  it('every hand-written invalid variant reports what it promises', () => {
    for (const c of INVALID_CASES) {
      const issues = expectInvalid(c.build());
      for (const expected of c.issues) {
        expect(
          issues.some((issue) => issue.code === expected.code && (expected.pointer === '*' || issue.pointer === expected.pointer)),
          `${c.id}: ${JSON.stringify(issues)}`,
        ).toBe(true);
      }
      if (c.only) expect(issues, c.id).toHaveLength(c.issues.length);
    }
  });

  it('an LText with base de but only en is a refine issue', () => {
    const issues = expectInvalid(setAt(minimalDoc(), ['identity', 'name'], { base: 'de', en: { v: 'Only', s: 'human' } }));
    expect(issues).toEqual([{ code: 'refine', pointer: '/identity/name', params: { rule: 'ltext_base_present' } }]);
  });

  it('the refine does not run on top of a broken field', () => {
    const issues = expectInvalid(setAt(minimalDoc(), ['identity', 'name'], { base: 'de', en: { v: 5, s: 'human' } }));
    expect(codes(issues)).toEqual(['type /identity/name/en/v']);
  });

  it('a threshold expression is validated through the expression schema', () => {
    const doc = clone(kitchenSinkDoc());
    expect(validateFormatDefinition(doc).ok).toBe(true);
    const missing = deleteAt(clone(doc), ['edges', 1, 'select', 0, 'when', 'args']);
    expect(codes(expectInvalid(missing))).toEqual(['required /edges/1/select/0/when/args']);
  });

  it('a mixed pile of problems is reported together, sorted, once each', () => {
    const doc = setAt(setAt(setAt(minimalDoc(), ['stages', 0, 'series', 'best_of'], 99), ['identity', 'name'], 5), ['extra'], 1);
    const issues = expectInvalid(doc);
    expect(codes(issues)).toEqual(['unknown_key /extra', 'type /identity/name', 'range /stages/0/series/best_of']);
    expect(issues).toEqual(sortIssues(issues));
  });
});

describe('type equality', () => {
  it('the schema output is assignable to and from FormatDefinition', () => {
    const result = formatDefinitionSchema.safeParse(minimalDocValidated());
    expect(result.success).toBe(true);
    const typed: FormatDefinition | undefined = result.success ? result.data : undefined;
    expect(typed?.schema_version).toBe(1);
  });
});

describe('schema folder hygiene', () => {
  const folder = path.resolve(__dirname, '../schema');
  const files = fs.readdirSync(folder).filter((name) => name.endsWith('.ts'));
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('uses no record type, no any, no transform', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    const banned = [/\bz\.record\b/, /\bz\.any\b/, /\bz\.looseObject\b/, /\.transform\s*\(/, /\.passthrough\s*\(/, /\.catchall\s*\(/, /\bz\.object\s*\(/];
    for (const file of files) {
      const text = strip(fs.readFileSync(path.join(folder, file), 'utf8'));
      for (const pattern of banned) expect(text, `${file} ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});

describe('issues helpers', () => {
  it('toPointer escapes ~ and / and accepts numbers', () => {
    expect(toPointer([])).toBe('');
    expect(toPointer(['a', 0, 'b/c', 'd~e'])).toBe('/a/0/b~1c/d~0e');
  });

  it('sortIssues orders by pointer, then code, and drops exact duplicates', () => {
    const a: SchemaIssue = { code: 'type', pointer: '/b', params: { expected: 'string' } };
    const b: SchemaIssue = { code: 'enum', pointer: '/b', params: {} };
    const c: SchemaIssue = { code: 'range', pointer: '/a', params: {} };
    const sorted = sortIssues([a, b, c, { ...c }, a]);
    expect(sorted.map((i) => `${i.pointer} ${i.code}`)).toEqual(['/a range', '/b enum', '/b type']);
    expect(sortIssues([])).toEqual([]);
  });

  it('finalizeIssues caps at MAX_ISSUES after sorting', () => {
    const many: SchemaIssue[] = Array.from({ length: 250 }, (_, i) => ({ code: 'range', pointer: `/${String(i).padStart(3, '0')}`, params: {} }));
    const out = finalizeIssues(many.slice().reverse());
    expect(out).toHaveLength(MAX_ISSUES);
    expect(out[0].pointer).toBe('/000');
    expect(out[MAX_ISSUES - 1].pointer).toBe('/099');
  });

  it('sortNotes orders by pointer', () => {
    const notes = sortNotes([
      { code: 'unknown_primitive', pointer: '/rules/2', params: { kind: 'b' } },
      { code: 'unknown_primitive', pointer: '/rules/1', params: { kind: 'a' } },
    ]);
    expect(notes.map((n) => n.pointer)).toEqual(['/rules/1', '/rules/2']);
  });

  describe('mapZodIssues', () => {
    it('maps every zod code', () => {
      const issues = mapZodIssues([
        { code: 'invalid_type', path: ['a'], input: undefined, expected: 'string' },
        { code: 'invalid_type', path: ['b'], input: 5, expected: 'string' },
        { code: 'invalid_type', path: ['c'], input: 5.5, expected: 'int' },
        { code: 'too_small', path: ['d'], input: 0, origin: 'number' },
        { code: 'too_big', path: ['e'], input: 9, origin: 'int' },
        { code: 'too_small', path: ['f'], input: '', origin: 'string' },
        { code: 'too_big', path: ['g'], input: [], origin: 'array' },
        { code: 'invalid_value', path: ['h'], input: 'x' },
        { code: 'invalid_value', path: ['i'], input: undefined },
        { code: 'invalid_format', path: ['j'], input: 'x' },
        { code: 'unrecognized_keys', path: ['k'], keys: ['one', 'tw/o'] },
        { code: 'invalid_union', path: ['l', 'kind'], input: { x: 1 }, discriminator: 'kind' },
        { code: 'invalid_union', path: ['m', 'kind'], input: { kind: 'z' }, discriminator: 'kind' },
        { code: 'invalid_union', path: ['n'], input: null },
        { code: 'custom', path: ['o'], input: [], params: { code: 'length' } },
        { code: 'custom', path: ['p'], input: {}, params: { code: 'refine', rule: 'r' } },
        { code: 'custom', path: ['q'], input: {}, params: { code: 'limit', limit: 'expr_nodes' } },
        { code: 'custom', path: ['r'], input: {}, params: { code: 'bogus' } },
        { code: 'custom', path: ['s'], input: {} },
        { code: 'not_multiple_of', path: ['t'], input: 3 },
      ]);
      expect(issues.map((i) => `${i.pointer} ${i.code} ${JSON.stringify(i.params)}`)).toEqual([
        '/a required {}',
        '/b type {"expected":"string"}',
        '/c type {"expected":"integer"}',
        '/d range {}',
        '/e range {}',
        '/f length {}',
        '/g length {}',
        '/h enum {}',
        '/i required {}',
        '/j pattern {}',
        '/k/one unknown_key {}',
        '/k/tw~1o unknown_key {}',
        '/l/kind required {}',
        '/m/kind enum {}',
        '/n type {"expected":"union"}',
        '/o length {}',
        '/p refine {"rule":"r"}',
        '/q limit {"limit":"expr_nodes"}',
        '/r refine {"rule":"custom"}',
        '/s refine {"rule":"custom"}',
        '/t refine {"rule":"not_multiple_of"}',
      ]);
    });

    it('does not treat a missing input field as an absent value', () => {
      expect(mapZodIssues([{ code: 'invalid_type', path: ['a'], expected: 'string' }])[0].code).toBe('type');
    });

    it('caps the unknown keys of one issue', () => {
      const keys = Array.from({ length: 300 }, (_, i) => `k${i}`);
      expect(mapZodIssues([{ code: 'unrecognized_keys', path: [], keys }])).toHaveLength(MAX_ISSUES);
    });
  });
});
