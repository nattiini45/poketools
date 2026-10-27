/**
 * The core acceptance test of the client/server split: the zod validator (`validate.ts`) and the
 * browser validator (`validate.browser.ts`, no zod) must return the SAME `ValidationResult` for
 * the same input: ok flag, normalised value, issues (code, pointer, params) and notes. The inputs
 * are the valid fixtures, the hand-written invalid variants, and seeded fuzz mutations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from '@/lib/studio-core/json';
import type { ValidationResult } from '../issues';
import { intBetween, mulberry32, pick, type Rng } from '../test-utils/prng';
import { validateFormatDefinition as validateZod } from '../validate';
import { validateFormatDefinition as validateBrowser } from '../validate.browser';
import { COMPILE_ONLY_CASES, INVALID_CASES, clone, nestedArray, setAt } from './fixtures/invalid';
import { VALID_DOCS, cupDoc, kitchenSinkDoc, minimalDoc, swissDoc } from './fixtures/docs';

function summarize(result: ValidationResult): unknown {
  if (!result.ok) return { ok: false, issues: result.issues };
  return { ok: true, value: canonicalizeJson(result.value), notes: result.notes };
}

function expectParity(input: unknown, label: string): ValidationResult {
  const zod = validateZod(input);
  const browser = validateBrowser(input);
  expect(summarize(browser), label).toEqual(summarize(zod));
  return zod;
}

// --- Seeded mutations ---------------------------------------------------------------------------

type Slot = { parent: Record<string, unknown> | unknown[]; key: string | number };

/**
 * Mutations stay out of the inside of expression slots: the expression twins (`expr/schema.ts`,
 * `expr/validate-json.ts`) have their own parity test, and this test is about the document layer.
 * The `when` slot itself may still be replaced or deleted.
 */
const EXPR_SLOT = 'when';

function collectSlots(root: unknown): Slot[] {
  const slots: Slot[] = [];
  const stack: { node: unknown; insideExpr: boolean }[] = [{ node: root, insideExpr: false }];
  while (stack.length > 0) {
    const { node, insideExpr } = stack.pop() as { node: unknown; insideExpr: boolean };
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        if (!insideExpr) slots.push({ parent: node, key: index });
        stack.push({ node: child, insideExpr });
      });
    } else if (typeof node === 'object' && node !== null) {
      for (const key of Object.keys(node)) {
        if (!insideExpr) slots.push({ parent: node as Record<string, unknown>, key });
        stack.push({ node: (node as Record<string, unknown>)[key], insideExpr: insideExpr || key === EXPR_SLOT });
      }
    }
  }
  return slots;
}

function read(slot: Slot): unknown {
  return (slot.parent as Record<string | number, unknown>)[slot.key];
}

function write(slot: Slot, value: unknown): void {
  if (slot.key === '__proto__') {
    Object.defineProperty(slot.parent, slot.key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    (slot.parent as Record<string | number, unknown>)[slot.key] = value;
  }
}

const REPLACEMENTS: readonly (() => unknown)[] = [
  () => null,
  () => 0,
  () => 1,
  () => -1,
  () => 2.5,
  () => 1e300,
  () => 'x',
  () => '',
  () => 'Bad Key!',
  () => 'a'.repeat(5000),
  () => 'with\u0000nul',
  () => true,
  () => false,
  () => [],
  () => ({}),
  () => [1, 2],
  () => ({ a: 1 }),
  () => nestedArray(70),
  () => ({ kind: 'top_n', n: 2 }),
];
const BOUNDARY_NUMBERS = [0, 1, 2, 3, 4, 5, 8, 9, 15, 16, 26, 27, 32, 33, 50, 51, 63, 64, 65, 200, 201, 1000, 1001, 1024, 1025, 4096, 4097, -1000, -1001];
const TAGS = ['swiss', 'round_robin', 'top_n', 'threshold', 'metric', 'coin_flip', 'bipartite', 'rule.on_event', 'rule.custom', 'rule.weird_kind', 'Not A Kind', 'constructor', 'roster', 'edges', 'season', 'stage', 'ruleset', 'preset'];
const EXTRA_KEYS = ['extra', '__proto__', 'constructor', 'toString', 'kind', 'zz'];
const RESERVED_INSERTS: readonly [string, unknown][] = [
  ['attributes', {}],
  ['domains', []],
  ['relations', { a: 1 }],
  ['constraints', []],
  ['end_when', null],
  ['calendar', {}],
];

function mutateOnce(doc: unknown, rng: Rng): void {
  const slots = collectSlots(doc);
  const slot = pick(rng, slots);
  const value = read(slot);
  const op = slot.key === EXPR_SLOT ? pick(rng, [0, 2, 3, 9]) : intBetween(rng, 0, 9);
  switch (op) {
    case 0: // delete
      if (Array.isArray(slot.parent)) slot.parent.splice(slot.key as number, 1);
      else delete slot.parent[slot.key as string];
      break;
    case 1: // add an extra key to an object
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        write({ parent: value as Record<string, unknown>, key: pick(rng, EXTRA_KEYS) }, pick(rng, [1, 'x', null, { a: 1 }]));
      }
      break;
    case 2:
    case 3: // swap the type or the value
      write(slot, pick(rng, REPLACEMENTS)());
      break;
    case 4: // boundary numbers
      if (typeof value === 'number') write(slot, pick(rng, BOUNDARY_NUMBERS));
      else write(slot, pick(rng, BOUNDARY_NUMBERS));
      break;
    case 5: // truncate an array
      if (Array.isArray(value) && value.length > 0) value.length = intBetween(rng, 0, value.length - 1);
      break;
    case 6: // extend an array
      if (Array.isArray(value)) {
        const target = pick(rng, [value.length + 1, 5, 13, 33, 51, 65, 201]);
        const template = value.length > 0 ? value[0] : { kind: 'coin_flip' };
        while (value.length < target) value.push(clone(template));
      }
      break;
    case 7: // change a tag
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value) {
        (value as Record<string, unknown>).kind = pick(rng, TAGS);
      } else if (typeof value === 'string') {
        write(slot, pick(rng, TAGS));
      }
      break;
    case 8: { // reserved names at the top or in a stage
      const [name, content] = pick(rng, RESERVED_INSERTS);
      const target = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : (doc as Record<string, unknown>);
      target[name] = content;
      break;
    }
    default: // long text
      if (typeof value === 'string') write(slot, 'y'.repeat(pick(rng, [3999, 4000, 4001, 40])));
      else write(slot, 'y'.repeat(4001));
  }
}

describe('validator parity: fixtures', () => {
  for (const { id, build } of VALID_DOCS) {
    it(`valid ${id}: both validators accept and agree`, () => {
      const result = expectParity(build(), id);
      expect(result.ok, id).toBe(true);
    });
  }

  for (const { id, build } of COMPILE_ONLY_CASES) {
    it(`compile-only ${id}: valid for both validators`, () => {
      const result = expectParity(build(), id);
      expect(result.ok, id).toBe(true);
    });
  }
});

describe('validator parity: hand-written invalid variants', () => {
  it('covers every issue code that validation can report', () => {
    const codes = new Set<string>();
    for (const c of INVALID_CASES) for (const issue of c.issues) codes.add(issue.code);
    for (const code of ['required', 'type', 'enum', 'range', 'length', 'pattern', 'unknown_key', 'not_available_yet', 'limit', 'refine']) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  for (const c of INVALID_CASES) {
    it(`invalid: ${c.id}`, () => {
      const result = expectParity(c.build(), c.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      for (const expected of c.issues) {
        expect(
          result.issues.some((issue) => issue.code === expected.code && (expected.pointer === '*' || issue.pointer === expected.pointer)),
          `${c.id}: ${JSON.stringify(result.issues)}`,
        ).toBe(true);
      }
      if (c.only) expect(result.issues.length, JSON.stringify(result.issues)).toBe(c.issues.length);
    });
  }
});

describe('validator parity: where zod behaves unusually', () => {
  const cases: [string, () => unknown][] = [
    ['150 unknown keys on the root', () => Object.assign(minimalDoc(), Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`junk_${i}`, i])))],
    ['150 unknown keys in a nested object', () => setAt(minimalDoc(), ['stages', 0, 'scoring'], { win: 3, ...Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`junk_${i}`, i])) })],
    ['unknown key with a slash and a tilde', () => ({ ...minimalDoc(), 'a/b~c': 1 })],
    ['60 stages, one of them broken', () => {
      const doc = minimalDoc();
      const stage = (doc.stages as Record<string, unknown>[])[0];
      doc.stages = Array.from({ length: 60 }, (_, i) => ({ ...clone(stage), key: `stage_${i}` }));
      setAt(doc, ['stages', 7, 'series', 'best_of'], 'three');
      return doc;
    }],
    ['300 rules with bad kinds', () => setAt(minimalDoc(), ['rules'], Array.from({ length: 300 }, (_, i) => ({ kind: i % 2 ? 'Bad Kind' : 5 })))],
    ['an object with a length key where a string is expected', () => setAt(minimalDoc(), ['stages', 0, 'key'], { length: 40 })],
    ['an object with a length key in a text value', () => setAt(minimalDoc(), ['identity', 'name', 'en', 'v'], { length: 0 })],
    ['an array where a string is expected', () => setAt(minimalDoc(), ['identity', 'name', 'en', 'v'], [])],
    ['a string where an array is expected', () => setAt(minimalDoc(), ['stages', 0, 'columns'], 'ab')],
    ['a long string where an array is expected', () => setAt(minimalDoc(), ['stages', 0, 'rank'], 'x'.repeat(50))],
    ['an object with a length key where an array is expected', () => setAt(minimalDoc(), ['stages', 0, 'rank'], { length: 99 })],
    ['a fact value that is an array', () => setAt(kitchenSinkDoc(), ['modules', 0, 'facts', 0, 'value'], [1])],
    ['a 64-character unknown rule kind', () => setAt(minimalDoc(), ['rules'], [{ kind: `a${'b'.repeat(63)}`, id: 'x' }])],
    ['a 65-character unknown rule kind', () => setAt(minimalDoc(), ['rules'], [{ kind: `a${'b'.repeat(64)}`, id: 'x' }])],
    ['an unknown rule kind that is also a prototype member', () => setAt(minimalDoc(), ['rules'], [{ kind: 'constructor', id: 'x' }])],
    ['swiss rounds that are boolean', () => setAt(swissDoc(), ['stages', 0, 'pairing', 'rounds'], true)],
    ['edge select that is a string', () => setAt(cupDoc(), ['edges', 0, 'select'], 'top_n')],
    ['participants without from', () => setAt(minimalDoc(), ['stages', 0, 'participants'], { seeding: 'random' })],
    ['everything at once', () => ({ schema_version: 'x', identity: [], stages: 'x', edges: {}, views: 5, rules: null, text: [], theme: 'x', modules: {}, attributes: 1 })],
  ];
  for (const [label, build] of cases) {
    it(label, () => {
      const result = expectParity(build(), label);
      expect(result.ok).toBe(label === 'a 64-character unknown rule kind' || label === 'an unknown rule kind that is also a prototype member' ? true : false);
    });
  }
});

describe('validator parity: seeded fuzz', () => {
  it('agrees on 2400 mutations of the valid documents', () => {
    const rng = mulberry32(20261024);
    const docs = VALID_DOCS.map((d) => d.build);
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 2400; i += 1) {
      const doc = clone(pick(rng, docs)());
      const edits = intBetween(rng, 1, 3);
      for (let e = 0; e < edits; e += 1) mutateOnce(doc, rng);
      const result = expectParity(doc, `mutation ${i}`);
      if (result.ok) accepted += 1;
      else rejected += 1;
    }
    // The fuzz must exercise both outcomes, otherwise it proves little.
    expect(rejected).toBeGreaterThan(600);
    expect(accepted).toBeGreaterThan(20);
  });

  it('agrees on hostile garbage and does not pollute Object.prototype', () => {
    const rng = mulberry32(77);
    for (let i = 0; i < 200; i += 1) {
      const doc = clone(pick(rng, VALID_DOCS).build());
      setAt(doc, ['__proto__'], JSON.parse('{"polluted":true}'));
      mutateOnce(doc, rng);
      expectParity(doc, `garbage ${i}`);
    }
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"schema_version":1}') as unknown;
    expectParity(parsed, 'JSON.parse __proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });
});

describe('browser entry closure', () => {
  const root = path.resolve(__dirname, '..');
  const files = [
    'validate.browser.ts',
    'expr/validate-json.ts',
    'issues.ts',
    'limits.ts',
    'types.ts',
    ...fs
      .readdirSync(path.join(root, 'registry'))
      .filter((name) => name.endsWith('.ts') && name !== 'server.ts')
      .map((name) => `registry/${name}`),
  ];

  const specifiers = (text: string): string[] =>
    [...text.matchAll(/(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('imports no zod, server-only, schema folder, validate.ts or registry/server', () => {
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      for (const specifier of specifiers(text)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^zod($|\/)/);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/server-only|@pkmn|^next($|\/)|^react($|\/)/);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)schema($|\/)|expr\/schema$|\.\/schema$|\/validate$|registry\/server$|\.\/server$/);
      }
    }
  });
});
