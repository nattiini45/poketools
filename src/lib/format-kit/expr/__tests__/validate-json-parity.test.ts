import { describe, expect, it } from 'vitest';
import type { ZodIssue } from 'zod';
import type { Expr, ExprType } from '../ast';
import { cloneJson, genExpr, genHostile, mutateJson, TEST_ENV, x } from '../../test-utils/gen-expr';
import { intBetween, mulberry32, pick } from '../../test-utils/prng';
import { escapePointerSegment } from '../../patch';
import { exprSchemaFor } from '../schema';
import { validateExprJson } from '../validate-json';

type Pair = `${string}|${string}`;

const toPointer = (path: PropertyKey[]): string => path.map((segment) => `/${escapePointerSegment(String(segment))}`).join('');

/**
 * The contract's zod issue mapping: invalid_type with no input is `required`, other invalid_type is
 * `type`; too_small / too_big on numbers is `range`, on strings and arrays `length`; invalid_value is
 * `enum`; invalid_format is `pattern`; unrecognized_keys is one `unknown_key` per key; custom passes
 * its own code through.
 */
function mapZodIssues(issues: readonly ZodIssue[]): Pair[] {
  const out: Pair[] = [];
  for (const issue of issues) {
    const pointer = toPointer(issue.path);
    switch (issue.code) {
      case 'invalid_type':
        out.push(`${'input' in issue && issue.input !== undefined ? 'type' : 'required'}|${pointer}`);
        break;
      case 'too_small':
      case 'too_big':
        out.push(`${issue.origin === 'number' || issue.origin === 'int' ? 'range' : 'length'}|${pointer}`);
        break;
      case 'invalid_value':
        out.push(`enum|${pointer}`);
        break;
      case 'invalid_format':
        out.push(`pattern|${pointer}`);
        break;
      case 'unrecognized_keys':
        for (const key of issue.keys) out.push(`unknown_key|${pointer}/${escapePointerSegment(key)}`);
        break;
      case 'custom':
        out.push(`${(issue.params as { code: string }).code}|${pointer}`);
        break;
      default:
        throw new Error(`unmapped zod issue code: ${issue.code} at ${pointer}`);
    }
  }
  return out.sort();
}

function viaZod(value: unknown, expected: ExprType | 'any'): Pair[] {
  const result = exprSchemaFor(expected).safeParse(value, { reportInput: true });
  return result.success ? [] : mapZodIssues(result.error.issues);
}

function viaJson(value: unknown, expected: ExprType | 'any'): Pair[] {
  return validateExprJson(value, expected)
    .map((issue): Pair => `${issue.code}|${issue.pointer}`)
    .sort();
}

function expectParity(value: unknown, expected: ExprType | 'any' = 'any'): void {
  let printed = '(not printable)';
  try {
    printed = JSON.stringify(value)?.slice(0, 400) ?? 'undefined';
  } catch {
    // a deep or cyclic input: the label is only for failure messages
  }
  const label = `${expected}: ${printed}`;
  expect(viaJson(value, expected), label).toEqual(viaZod(value, expected));
}

describe('validateExprJson mirrors exprSchema', () => {
  it('both accept generated ASTs, for every root type', () => {
    const rng = mulberry32(555);
    for (let i = 0; i < 300; i += 1) {
      const type = pick(rng, ['number', 'boolean', 'text'] as const);
      const expr = genExpr(rng, TEST_ENV, type, intBetween(rng, 1, 150));
      expect(validateExprJson(expr, type)).toEqual([]);
      expect(viaZod(expr, type)).toEqual([]);
      expectParity(expr, 'any');
    }
  });

  it('agree on 1500 mutated inputs (key deletion, extra key, type swap, truncated arrays, deep nesting)', () => {
    const rng = mulberry32(8_675_309);
    let rejected = 0;
    const codes = new Set<string>();
    for (let i = 0; i < 1500; i += 1) {
      const type = pick(rng, ['number', 'boolean', 'text'] as const);
      const base = genExpr(rng, TEST_ENV, type, intBetween(rng, 1, 80));
      let mutated: unknown = mutateJson(rng, base);
      if (rng() < 0.3) mutated = mutateJson(rng, mutated);
      const expected = pick(rng, ['any', type, pick(rng, ['number', 'boolean', 'text'] as const)] as const);
      expectParity(mutated, expected);
      const issues = viaJson(mutated, expected);
      if (issues.length > 0) rejected += 1;
      for (const issue of issues) codes.add(issue.split('|')[0]);
    }
    expect(rejected).toBeGreaterThan(900);
    // The mutations reach every issue code the validators can produce.
    expect([...codes].sort()).toEqual(['enum', 'length', 'limit', 'pattern', 'range', 'required', 'type', 'unknown_key'].sort());
  });

  it('agree on 600 hostile inputs', () => {
    const rng = mulberry32(13);
    for (let i = 0; i < 600; i += 1) {
      const value = genHostile(rng);
      expectParity(value, 'any');
      expectParity(value, pick(rng, ['number', 'boolean', 'text'] as const));
    }
  });

  it('agree on one hand-written case per issue code', () => {
    const cases: [string, unknown, string][] = [
      ['required (missing field)', { k: 'num' }, 'required|/v'],
      ['required (missing kind)', {}, 'required|/k'],
      ['required (undefined child)', { k: 'neg', a: undefined }, 'required|/a'],
      ['type', { k: 'num', v: '1' }, 'type|/v'],
      ['type (not an object)', 5, 'type|'],
      ['type (null child)', { k: 'not', a: null }, 'type|/a'],
      ['enum (kind)', { k: 'zzz' }, 'enum|/k'],
      ['enum (operator)', { k: 'arith', op: '%', a: x.num(1), b: x.num(2) }, 'enum|/op'],
      ['range (digits)', { k: 'round', x: x.num(1), digits: 9 }, 'range|/digits'],
      ['length (arity)', { k: 'and', args: [x.bool(true)] }, 'length|/args'],
      ['length (set)', { k: 'in', a: x.num(1), set: [] }, 'length|/set'],
      ['pattern (ref name)', { k: 'ref', name: 'A', t: 'number' }, 'pattern|/name'],
      ['pattern (key)', { k: 'rand', key: '9' }, 'pattern|/key'],
      ['unknown_key', { k: 'num', v: 1, extra: 1 }, 'unknown_key|/extra'],
      ['limit', x.chain(33), 'limit|'],
    ];
    for (const [name, value, expected] of cases) {
      expect(viaJson(value, 'any'), name).toContain(expected);
      expectParity(value);
    }
  });

  it('reject an own __proto__ key as unknown_key without touching Object.prototype', () => {
    const hostile = JSON.parse('{"k":"num","v":1,"__proto__":{"polluted":true}}') as unknown;
    expect(viaJson(hostile, 'any')).toEqual(['unknown_key|/__proto__']);
    expect(viaZod(hostile, 'any')).toEqual(['unknown_key|/__proto__']);
    const nested = JSON.parse('{"k":"fn","fn":"min","args":[{"k":"num","v":1},{"k":"num","v":2,"__proto__":{}}]}') as unknown;
    expect(viaJson(nested, 'any')).toEqual(['unknown_key|/args/1/__proto__']);
    expectParity(nested);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('escape keys in pointers the same way', () => {
    const odd = { k: 'num', v: 1, 'a/b': 1, 'c~d': 2 };
    expect(viaJson(odd, 'any')).toEqual(['unknown_key|/a~1b', 'unknown_key|/c~0d']);
    expectParity(odd);
  });

  it('agree on the document limits and stop without recursing into hostile trees', () => {
    expectParity(x.nodes(256));
    expectParity(x.nodes(257));
    expectParity(x.chain(32));
    expectParity(x.chain(33));
    expect(viaJson(x.nodes(257), 'any')).toEqual(['limit|']);
    expect(validateExprJson(x.nodes(257), 'any')).toEqual([{ code: 'limit', pointer: '', params: { limit: 'expr_nodes' } }]);
    expect(validateExprJson(x.chain(33), 'any')).toEqual([{ code: 'limit', pointer: '', params: { limit: 'expr_depth' } }]);

    let deep: Expr = x.num(1);
    for (let i = 0; i < 100_000; i += 1) deep = x.neg(deep);
    expect(validateExprJson(deep, 'any')).toEqual([{ code: 'limit', pointer: '', params: { limit: 'expr_depth' } }]);
    expectParity(deep);

    const wide = { k: 'and', args: new Array(1_000_000).fill({ k: 'bool', v: true }) };
    expect(validateExprJson(wide, 'boolean')).toEqual([{ code: 'limit', pointer: '', params: { limit: 'expr_nodes' } }]);

    const cyclic: Record<string, unknown> = { k: 'not' };
    cyclic.a = cyclic;
    expect(validateExprJson(cyclic, 'any')[0]).toMatchObject({ code: 'limit' });
    expectParity(cyclic);
  });

  it('agree on the root type assertion, which is decided before the structure', () => {
    expect(validateExprJson(x.num(1), 'boolean')).toEqual([{ code: 'type', pointer: '', params: { expected: 'boolean', actual: 'number' } }]);
    expect(validateExprJson(x.cmp('<', x.num(1), x.num(2)), 'number')).toMatchObject([{ code: 'type', pointer: '' }]);
    expect(validateExprJson(x.ifx(x.bool(true), x.num(1), x.num(2)), 'boolean')).toEqual([]);
    // The root type is decided first, so it hides structural issues.
    expect(validateExprJson({ k: 'num', v: 'x' }, 'boolean')).toMatchObject([{ code: 'type', pointer: '' }]);
    expect(validateExprJson({ k: 'num', v: 'x' }, 'number')).toMatchObject([{ code: 'type', pointer: '/v' }]);
    for (const type of ['number', 'boolean', 'text'] as const) {
      for (const sample of [x.num(1), x.bool(true), x.str('a'), x.ref('points'), x.rand('coin'), x.agg('any', 'standings', { where: x.bool(true) })]) {
        expectParity(sample, type);
      }
    }
  });

  it('never throws on any input', () => {
    const values: unknown[] = [undefined, null, 0, '', [], {}, [[]], { k: null }, { k: [] }, Symbol('x'), () => 1, Object.create(Date.prototype), new Map(), Object.create(null)];
    for (const value of values) expect(() => validateExprJson(value, 'any')).not.toThrow();
  });
});

describe('cloneJson and mutateJson (test support)', () => {
  it('mutations are JSON and deterministic for a seed', () => {
    const base = cloneJson(x.arith('+', x.num(1), x.ref('points')));
    const a = mutateJson(mulberry32(1), base);
    const b = mutateJson(mulberry32(1), base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(base).toEqual(x.arith('+', x.num(1), x.ref('points')));
  });
});
