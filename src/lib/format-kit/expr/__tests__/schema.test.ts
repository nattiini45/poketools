import { describe, expect, it } from 'vitest';
import type { ZodIssue } from 'zod';
import { x, genExpr, TEST_ENV } from '../../test-utils/gen-expr';
import { intBetween, mulberry32, pick } from '../../test-utils/prng';
import { EXPR_SCHEMA_MAX_DEPTH, EXPR_SCHEMA_MAX_NODES } from '../limits';
import { exprSchema, exprSchemaFor } from '../schema';
import type { ExprType } from '../ast';

type Report = { success: boolean; issues: ZodIssue[] };

function parse(value: unknown, schema = exprSchema): Report {
  const result = schema.safeParse(value, { reportInput: true });
  return result.success ? { success: true, issues: [] } : { success: false, issues: result.error.issues };
}

const describeIssues = (issues: ZodIssue[]): string[] =>
  issues.map((i) => `${i.code}@/${i.path.join('/')}${'keys' in i ? `:${(i.keys as string[]).join(',')}` : ''}`);

describe('exprSchema', () => {
  it('accepts every generated AST and returns it unchanged', () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 600; i += 1) {
      const expr = genExpr(rng, TEST_ENV, pick(rng, ['number', 'boolean', 'text'] as const), intBetween(rng, 1, 150));
      const result = exprSchema.safeParse(JSON.parse(JSON.stringify(expr)));
      expect(result.success, JSON.stringify(expr)).toBe(true);
      if (result.success) expect(result.data).toEqual(expr);
    }
  });

  it('accepts every node kind with optional parts', () => {
    expect(parse(x.agg('count', 'standings')).success).toBe(true);
    expect(parse(x.agg('sum', 'standings', { of: x.item('points'), where: x.bool(true) })).success).toBe(true);
    expect(parse(x.inSet(x.ref('tag', 'text'), ['a', 'b'])).success).toBe(true);
    expect(parse({ k: 'agg', fn: 'count', over: 'standings', of: undefined }).success).toBe(true);
  });

  it('does not judge literal ranges or types: typeCheck reports those with expr_* codes', () => {
    expect(parse(x.num(5e9)).success).toBe(true);
    expect(parse(x.str('x'.repeat(500))).success).toBe(true);
    expect(parse(x.arith('+', x.num(1), x.bool(true))).success).toBe(true);
    expect(parse(x.ref('nope')).success).toBe(true);
  });

  it('rejects extra keys, one issue per key', () => {
    expect(describeIssues(parse({ k: 'num', v: 1, extra: 1 }).issues)).toEqual(['unrecognized_keys@/:extra']);
    expect(describeIssues(parse({ k: 'neg', a: { k: 'num', v: 1, z: 1 }, y: 2 }).issues).sort()).toEqual(['unrecognized_keys@/:y', 'unrecognized_keys@/a:z']);
  });

  it('rejects an own __proto__ key as an unknown key and never pollutes Object.prototype', () => {
    const hostile = JSON.parse('{"k":"num","v":1,"__proto__":{"polluted":true}}') as unknown;
    expect(describeIssues(parse(hostile).issues)).toEqual(['unrecognized_keys@/:__proto__']);
    const nested = JSON.parse('{"k":"neg","a":{"k":"num","v":1,"__proto__":{"polluted":true}}}') as unknown;
    expect(describeIssues(parse(nested).issues)).toEqual(['unrecognized_keys@/a:__proto__']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('reports a bad or missing kind as invalid_value / invalid_type, never invalid_union', () => {
    expect(parse({ k: 'zzz' }).issues.map((i) => i.code)).toEqual(['invalid_value']);
    expect(parse({ k: 3 }).issues.map((i) => i.code)).toEqual(['invalid_value']);
    expect(parse({ k: 'constructor' }).issues.map((i) => i.code)).toEqual(['invalid_value']);
    expect(describeIssues(parse({}).issues)).toEqual(['invalid_type@/k']);
    expect(parse(null).issues.map((i) => i.code)).toEqual(['invalid_type']);
    expect(parse([]).issues.map((i) => i.code)).toEqual(['invalid_type']);
    expect(parse('x').issues.map((i) => i.code)).toEqual(['invalid_type']);
    expect(parse(undefined).issues.map((i) => i.code)).toEqual(['invalid_type']);
    expect(describeIssues(parse({ k: 'neg', a: { k: 'q' } }).issues)).toEqual(['invalid_value@/a/k']);
  });

  it('rejects bad enums, patterns and field types', () => {
    expect(describeIssues(parse({ k: 'arith', op: '^', a: x.num(1), b: x.num(2) }).issues)).toEqual(['invalid_value@/op']);
    expect(describeIssues(parse({ k: 'cmp', op: '=', a: x.num(1), b: x.num(2) }).issues)).toEqual(['invalid_value@/op']);
    expect(describeIssues(parse({ k: 'fn', fn: 'avg', args: [x.num(1), x.num(2)] }).issues)).toEqual(['invalid_value@/fn']);
    expect(describeIssues(parse({ k: 'ref', name: 'Points', t: 'number' }).issues)).toEqual(['invalid_format@/name']);
    expect(describeIssues(parse({ k: 'ref', name: 'a.b.c', t: 'number' }).issues)).toEqual(['invalid_format@/name']);
    expect(describeIssues(parse({ k: 'ref', name: 'points', t: 'string' }).issues)).toEqual(['invalid_value@/t']);
    expect(describeIssues(parse({ k: 'rand', key: '__proto__' }).issues)).toEqual(['invalid_format@/key']);
    expect(describeIssues(parse({ k: 'rel', relation: 'A', a: x.str('a'), b: x.str('b') }).issues)).toEqual(['invalid_format@/relation']);
    expect(describeIssues(parse({ k: 'num', v: '1' }).issues)).toEqual(['invalid_type@/v']);
    expect(describeIssues(parse({ k: 'num' }).issues)).toEqual(['invalid_type@/v']);
    expect(parse({ k: 'num', v: Number.NaN }).success).toBe(false);
    expect(describeIssues(parse({ k: 'round', x: x.num(1), digits: 7 }).issues)).toEqual(['too_big@/digits']);
    expect(describeIssues(parse({ k: 'round', x: x.num(1), digits: 1.5 }).issues)).toEqual(['invalid_type@/digits']);
  });

  it('enforces arity and set size', () => {
    expect(parse(x.fn('min', x.num(1), x.num(2))).success).toBe(true);
    expect(describeIssues(parse({ k: 'fn', fn: 'min', args: [x.num(1)] }).issues)).toEqual(['too_small@/args']);
    expect(describeIssues(parse({ k: 'and', args: Array.from({ length: 9 }, () => x.bool(true)) }).issues)).toEqual(['too_big@/args']);
    expect(parse({ k: 'or', args: Array.from({ length: 8 }, () => x.bool(true)) }).success).toBe(true);
    expect(describeIssues(parse({ k: 'in', a: x.num(1), set: [] }).issues)).toEqual(['too_small@/set']);
    expect(describeIssues(parse({ k: 'in', a: x.num(1), set: Array.from({ length: 33 }, (_, i) => i) }).issues)).toEqual(['too_big@/set']);
    expect(parse({ k: 'in', a: x.num(1), set: Array.from({ length: 32 }, (_, i) => i) }).success).toBe(true);
    const badItems = parse({ k: 'in', a: x.num(1), set: [1, true, null, 'a'] });
    expect(badItems.issues.map((i) => `${i.code}@${i.path.join('/')}`)).toEqual(['custom@set/1', 'custom@set/2']);
    expect(badItems.issues.every((i) => i.code === 'custom' && (i.params as { code: string }).code === 'type')).toBe(true);
  });
});

describe('document-level limits protect zod from unbounded trees', () => {
  const limitOf = (report: Report): unknown => report.issues.map((i) => (i.code === 'custom' ? (i.params as { code: string; limit: string }) : i.code));

  it('256 nodes pass and 257 give a limit issue', () => {
    expect(parse(x.nodes(EXPR_SCHEMA_MAX_NODES)).success).toBe(true);
    const over = parse(x.nodes(EXPR_SCHEMA_MAX_NODES + 1));
    expect(over.success).toBe(false);
    expect(limitOf(over)).toEqual([{ code: 'limit', limit: 'expr_nodes' }]);
    expect(over.issues[0].path).toEqual([]);
  });

  it('depth 32 passes and 33 gives a limit issue', () => {
    expect(parse(x.chain(EXPR_SCHEMA_MAX_DEPTH)).success).toBe(true);
    expect(limitOf(parse(x.chain(EXPR_SCHEMA_MAX_DEPTH + 1)))).toEqual([{ code: 'limit', limit: 'expr_depth' }]);
  });

  it('a 100000-deep tree is a limit issue and zod never recurses into it', () => {
    let deep = x.num(1);
    for (let i = 0; i < 100_000; i += 1) deep = x.neg(deep);
    expect(limitOf(parse(deep))).toEqual([{ code: 'limit', limit: 'expr_depth' }]);
    let object: unknown = { k: 'num', v: 1 };
    for (let i = 0; i < 50_000; i += 1) object = { k: 'and', args: [object, { k: 'bool', v: true }] };
    expect(limitOf(parse(object))).toEqual([{ code: 'limit', limit: 'expr_depth' }]);
    const cyclic: Record<string, unknown> = { k: 'neg' };
    cyclic.a = cyclic;
    expect(limitOf(parse(cyclic))).toEqual([{ code: 'limit', limit: 'expr_depth' }]);
  });

  it('a 1,000,000-element args array is a limit issue', () => {
    const wide = { k: 'and', args: new Array(1_000_000).fill({ k: 'bool', v: true }) };
    expect(limitOf(parse(wide))).toEqual([{ code: 'limit', limit: 'expr_nodes' }]);
  });
});

describe('exprSchemaFor: static root type', () => {
  const ok = (type: ExprType | 'any', value: unknown): boolean => parse(value, exprSchemaFor(type)).success;
  const typeIssue = (type: ExprType | 'any', value: unknown): unknown => {
    const issues = parse(value, exprSchemaFor(type)).issues;
    return issues.map((i) => (i.code === 'custom' ? { path: i.path, ...(i.params as object) } : i.code));
  };

  it('boolean roots', () => {
    for (const e of [
      x.cmp('<', x.num(1), x.num(2)),
      x.and(x.bool(true), x.bool(false)),
      x.or(x.bool(true), x.bool(false)),
      x.not(x.bool(true)),
      x.inSet(x.num(1), [1]),
      x.rel('same_group', x.str('a'), x.str('b')),
      x.agg('any', 'standings', { where: x.bool(true) }),
      x.agg('all', 'standings', { where: x.bool(true) }),
      x.bool(true),
      x.ref('is_seed', 'boolean'),
    ]) {
      expect(ok('boolean', e), JSON.stringify(e)).toBe(true);
      expect(ok('number', e), JSON.stringify(e)).toBe(false);
    }
  });

  it('number roots', () => {
    for (const e of [
      x.num(1),
      x.arith('+', x.num(1), x.num(2)),
      x.neg(x.ref('points')),
      x.fn('min', x.num(1), x.num(2)),
      x.clamp(x.num(1), x.num(0), x.num(2)),
      x.round(x.num(1), 2),
      x.rand('coin'),
      x.agg('count', 'standings'),
      x.agg('sum', 'standings', { of: x.item('points') }),
      x.agg('min', 'standings', { of: x.item('points') }),
      x.ref('points'),
    ]) {
      expect(ok('number', e), JSON.stringify(e)).toBe(true);
      expect(ok('boolean', e), JSON.stringify(e)).toBe(false);
    }
  });

  it('reports a mismatch as a custom type issue at the root', () => {
    expect(typeIssue('boolean', x.num(1))).toEqual([{ path: [], code: 'type', expected: 'boolean', actual: 'number' }]);
    expect(typeIssue('number', x.str('a'))).toEqual([{ path: [], code: 'type', expected: 'number', actual: 'text' }]);
    expect(typeIssue('text', x.ref('points'))).toEqual([{ path: [], code: 'type', expected: 'text', actual: 'number' }]);
  });

  it('leaves `if` roots, unknown shapes and `any` to the other checks', () => {
    expect(ok('boolean', x.ifx(x.bool(true), x.num(1), x.num(2)))).toBe(true);
    expect(ok('any', x.num(1))).toBe(true);
    expect(ok('any', x.bool(true))).toBe(true);
    expect(ok('text', x.ifx(x.bool(true), x.str('a'), x.str('b')))).toBe(true);
  });

  it('decides the root type before the structure', () => {
    expect(typeIssue('boolean', { k: 'num', v: 'x' })).toEqual([{ path: [], code: 'type', expected: 'boolean', actual: 'number' }]);
    expect(typeIssue('number', { k: 'num', v: 'x' })).toEqual(['invalid_type']);
    // An unknown kind has no static type: the structural issue is reported.
    expect(typeIssue('boolean', { k: 'zzz' })).toEqual(['invalid_value']);
  });

  it('shares the same schema object per type', () => {
    expect(exprSchemaFor('boolean')).toBe(exprSchemaFor('boolean'));
    expect(exprSchemaFor('any')).toBe(exprSchema);
  });
});
