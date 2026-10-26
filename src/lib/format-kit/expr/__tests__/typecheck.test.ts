import { describe, expect, it } from 'vitest';
import type { CollectionType, Expr, ExprType, TypeEnv } from '../ast';
import { TEST_ENV, x } from '../../test-utils/gen-expr';
import { EXPR_STEP_BUDGET } from '../limits';
import { MAX_TYPECHECK_ISSUES, typeCheck } from '../typecheck';

/** "code@pointer" for every issue, in report order. */
function issuesOf(e: unknown, env: TypeEnv = TEST_ENV, expected?: ExprType): string[] {
  const result = typeCheck(e as Expr, env, expected);
  return result.ok ? [] : result.issues.map((i) => `${i.code}@${i.pointer}`);
}

const bigEnv: TypeEnv = {
  refs: new Map(),
  collections: new Map<string, CollectionType>([['big', { fields: new Map<string, ExprType>([['v', 'number']]), maxSize: 256 }]]),
  relations: new Set(),
};

/** `sum(big of item.v + item.v + ...)` whose body has exactly `bodyNodes` nodes (odd). */
function sumWithBody(bodyNodes: number): Expr {
  let body: Expr = x.item('v');
  for (let i = 1; i < bodyNodes; i += 2) body = x.arith('+', body, x.item('v'));
  return x.agg('sum', 'big', { of: body });
}

describe('typeCheck: results', () => {
  it('returns type, nodes, depth and the static step bound', () => {
    expect(typeCheck(x.arith('+', x.ref('points'), x.num(1)), TEST_ENV)).toEqual({ ok: true, type: 'number', nodes: 3, depth: 2, maxSteps: 4 });
    expect(typeCheck(x.cmp('==', x.str('a'), x.ref('tag', 'text')), TEST_ENV, 'boolean')).toMatchObject({ ok: true, type: 'boolean' });
    // 1 aggregate node + 16 rows * (1 + 3 body nodes) + 1
    const count = x.agg('count', 'standings', { where: x.cmp('>', x.item('points'), x.num(3)) });
    expect(typeCheck(count, TEST_ENV)).toEqual({ ok: true, type: 'number', nodes: 4, depth: 3, maxSteps: 1 + 16 * 4 + 1 });
  });

  it('accepts every well-typed form', () => {
    const forms: Expr[] = [
      x.neg(x.ref('points')),
      x.fn('min', x.num(1), x.num(2), x.ref('wins')),
      x.clamp(x.ref('points'), x.num(0), x.num(10)),
      x.round(x.ref('points'), 2),
      x.cmp('<=', x.ref('points'), x.num(3)),
      x.cmp('!=', x.ref('is_seed', 'boolean'), x.bool(false)),
      x.and(x.bool(true), x.not(x.bool(false))),
      x.or(x.bool(true), x.bool(false)),
      x.ifx(x.bool(true), x.str('a'), x.ref('tag', 'text')),
      x.inSet(x.ref('points'), [1, 2]),
      x.inSet(x.ref('tag', 'text'), ['a']),
      x.rel('same_group', x.str('a'), x.ref('label', 'text')),
      x.rand('coin'),
      x.agg('any', 'players', { where: x.cmp('>', x.item('rating'), x.ref('points')) }),
      x.agg('all', 'players', { where: x.cmp('==', x.item('group', 'text'), x.str('a')) }),
      x.agg('max', 'standings', { of: x.item('points'), where: x.item('active', 'boolean') }),
    ];
    for (const form of forms) expect(issuesOf(form)).toEqual([]);
  });

  it('checks the expected result type', () => {
    expect(issuesOf(x.num(1), TEST_ENV, 'number')).toEqual([]);
    expect(issuesOf(x.num(1), TEST_ENV, 'boolean')).toEqual(['expr_result_type@']);
    expect(issuesOf(x.bool(true), TEST_ENV, 'number')).toEqual(['expr_result_type@']);
    const result = typeCheck(x.str('a'), TEST_ENV, 'boolean');
    expect(result).toEqual({ ok: false, issues: [{ code: 'expr_result_type', pointer: '', params: { expected: 'boolean', actual: 'text' } }] });
  });

  it('treats keys named like Object.prototype members as ordinary names', () => {
    expect(issuesOf(x.ref('constructor'))).toEqual([]);
    expect(issuesOf(x.ref('toString'))).toEqual(['expr_unknown_ref@/name']);
    expect(issuesOf(x.ref('hasOwnProperty'))).toEqual(['expr_unknown_ref@/name']);
  });
});

describe('typeCheck: every issue code, pass and fail', () => {
  it('expr_shape', () => {
    expect(issuesOf(x.num(1))).toEqual([]);
    expect(issuesOf({ k: 'zzz' })).toEqual(['expr_shape@/k']);
    expect(issuesOf(5)).toEqual(['expr_shape@']);
    expect(issuesOf(undefined)).toEqual(['expr_shape@']);
    expect(issuesOf({ k: 'num', v: 'x' })).toEqual(['expr_shape@/v']);
    expect(issuesOf({ k: 'neg' })).toEqual(['expr_shape@/a']);
    expect(issuesOf({ k: 'fn', fn: 'min', args: 5 })).toEqual(['expr_shape@/args']);
    expect(issuesOf({ k: 'arith', op: '^', a: x.num(1), b: x.num(2) })).toEqual(['expr_shape@/op']);
    expect(issuesOf({ k: 'ref', name: 'points', t: 'string' })).toEqual(['expr_shape@/t']);
    expect(issuesOf({ k: 'rand', key: 'Bad Key' })).toEqual(['expr_shape@/key']);
    expect(issuesOf({ k: 'round', x: x.num(1), digits: 1.5 })).toEqual(['expr_shape@/digits']);
    expect(issuesOf({ k: 'in', a: x.num(1), set: 'x' })).toEqual(['expr_shape@/set']);
    expect(issuesOf({ k: 'in', a: x.num(1), set: [true] })).toEqual(['expr_shape@/set/0']);
  });

  it('expr_depth: 12 passes, 13 fails', () => {
    expect(typeCheck(x.chain(12), TEST_ENV)).toMatchObject({ ok: true, depth: 12, nodes: 12 });
    expect(typeCheck(x.chain(13), TEST_ENV)).toEqual({ ok: false, issues: [{ code: 'expr_depth', pointer: '', params: { limit: 12 } }] });
  });

  it('expr_nodes: 200 passes, 201 fails', () => {
    expect(typeCheck(x.nodes(200), TEST_ENV)).toMatchObject({ ok: true, nodes: 200 });
    expect(typeCheck(x.nodes(201), TEST_ENV)).toEqual({ ok: false, issues: [{ code: 'expr_nodes', pointer: '', params: { limit: 200 } }] });
  });

  it('expr_steps: aggregate over 256 rows against the 5000 budget', () => {
    // 3-node body: 1 + 256 * 4 + 1 = 1026 steps.
    expect(typeCheck(sumWithBody(3), bigEnv)).toMatchObject({ ok: true, maxSteps: 1026 });
    // 17-node body: 1 + 256 * 18 + 1 = 4610; 19-node body: 1 + 256 * 20 + 1 = 5122 > 5000.
    expect(typeCheck(sumWithBody(17), bigEnv)).toMatchObject({ ok: true, maxSteps: 4610 });
    expect(typeCheck(sumWithBody(19), bigEnv)).toEqual({
      ok: false,
      issues: [{ code: 'expr_steps', pointer: '', params: { maxSteps: 5122, budget: EXPR_STEP_BUDGET } }],
    });
    // Four 3-node aggregates fit, five do not (their costs add up).
    const four = x.fn('max', sumWithBody(3), sumWithBody(3), sumWithBody(3), sumWithBody(3));
    expect(typeCheck(four, bigEnv)).toMatchObject({ ok: true, maxSteps: 5 + 4 * 1024 + 1 });
    const five = x.fn('max', sumWithBody(3), sumWithBody(3), sumWithBody(3), sumWithBody(3), sumWithBody(3));
    expect(issuesOf(five, bigEnv)).toEqual(['expr_steps@']);
  });

  it('expr_type_mismatch', () => {
    expect(issuesOf(x.arith('+', x.num(1), x.num(2)))).toEqual([]);
    expect(issuesOf(x.arith('+', x.num(1), x.bool(true)))).toEqual(['expr_type_mismatch@/b']);
    expect(issuesOf(x.neg(x.str('a')))).toEqual(['expr_type_mismatch@/a']);
    expect(issuesOf(x.cmp('<', x.str('a'), x.str('b')))).toEqual(['expr_type_mismatch@/a', 'expr_type_mismatch@/b']);
    expect(issuesOf(x.cmp('==', x.num(1), x.str('a')))).toEqual(['expr_type_mismatch@/b']);
    expect(issuesOf(x.and(x.bool(true), x.num(1)))).toEqual(['expr_type_mismatch@/args/1']);
    expect(issuesOf(x.not(x.num(1)))).toEqual(['expr_type_mismatch@/a']);
    expect(issuesOf(x.ifx(x.num(1), x.num(1), x.num(2)))).toEqual(['expr_type_mismatch@/cond']);
    expect(issuesOf(x.ifx(x.bool(true), x.num(1), x.str('a')))).toEqual(['expr_type_mismatch@/else']);
    expect(issuesOf(x.inSet(x.ref('points'), [1, 'a']))).toEqual(['expr_type_mismatch@/set/1']);
    expect(issuesOf(x.inSet(x.ref('tag', 'text'), [1]))).toEqual(['expr_type_mismatch@/set/0']);
    expect(issuesOf(x.inSet(x.bool(true), [1]))).toEqual(['expr_type_mismatch@/a']);
    expect(issuesOf(x.rel('same_group', x.num(1), x.str('a')))).toEqual(['expr_type_mismatch@/a']);
    expect(issuesOf(x.clamp(x.num(1), x.str('a'), x.num(2)))).toEqual(['expr_type_mismatch@/lo']);
    expect(issuesOf(x.round(x.bool(true), 1))).toEqual(['expr_type_mismatch@/x']);
    expect(issuesOf(x.agg('sum', 'standings', { of: x.bool(true) }))).toEqual(['expr_type_mismatch@/of']);
    expect(issuesOf(x.agg('count', 'standings', { where: x.num(1) }))).toEqual(['expr_type_mismatch@/where']);
  });

  it('expr_unknown_ref', () => {
    expect(issuesOf(x.ref('points'))).toEqual([]);
    expect(issuesOf(x.ref('nope'))).toEqual(['expr_unknown_ref@/name']);
  });

  it('expr_ref_type', () => {
    expect(issuesOf(x.ref('points', 'number'))).toEqual([]);
    expect(issuesOf(x.ref('points', 'text'))).toEqual(['expr_ref_type@/t']);
    const result = typeCheck(x.ref('tag', 'number'), TEST_ENV);
    expect(result).toEqual({ ok: false, issues: [{ code: 'expr_ref_type', pointer: '/t', params: { name: 'tag', expected: 'text', actual: 'number' } }] });
    expect(issuesOf(x.agg('sum', 'standings', { of: x.item('points', 'text') }))).toEqual(['expr_ref_type@/of/t']);
  });

  it('expr_unknown_relation', () => {
    expect(issuesOf(x.rel('played', x.str('a'), x.str('b')))).toEqual([]);
    expect(issuesOf(x.rel('nope', x.str('a'), x.str('b')))).toEqual(['expr_unknown_relation@/relation']);
  });

  it('expr_unknown_collection', () => {
    expect(issuesOf(x.agg('count', 'standings'))).toEqual([]);
    expect(issuesOf(x.agg('count', 'nope'))).toEqual(['expr_unknown_collection@/over']);
  });

  it('expr_unknown_field', () => {
    expect(issuesOf(x.agg('sum', 'standings', { of: x.item('points') }))).toEqual([]);
    expect(issuesOf(x.agg('sum', 'standings', { of: x.item('rating') }))).toEqual(['expr_unknown_field@/of/name']);
    // A field of another collection is not in scope.
    expect(issuesOf(x.agg('sum', 'players', { of: x.item('points') }))).toEqual(['expr_unknown_field@/of/name']);
    expect(issuesOf(x.agg('count', 'standings', { where: x.cmp('>', x.item('zzz'), x.num(1)) }))).toEqual(['expr_unknown_field@/where/a/name']);
  });

  it('expr_arity', () => {
    expect(issuesOf(x.fn('max', x.num(1), x.num(2)))).toEqual([]);
    expect(issuesOf(x.fn('max', x.num(1)))).toEqual(['expr_arity@/args']);
    expect(issuesOf(x.and(x.bool(true)))).toEqual(['expr_arity@/args']);
    expect(issuesOf(x.or(...Array.from({ length: 9 }, () => x.bool(true))))).toEqual(['expr_arity@/args']);
    expect(issuesOf(x.and(...Array.from({ length: 8 }, () => x.bool(true))))).toEqual([]);
    expect(issuesOf(x.inSet(x.num(1), []))).toEqual(['expr_arity@/set']);
    expect(issuesOf(x.inSet(x.num(1), Array.from({ length: 33 }, (_, i) => i)))).toEqual(['expr_arity@/set']);
    expect(issuesOf(x.inSet(x.num(1), Array.from({ length: 32 }, (_, i) => i)))).toEqual([]);
    // Aggregate argument rules.
    expect(issuesOf(x.agg('sum', 'standings'))).toEqual(['expr_arity@']);
    expect(issuesOf(x.agg('min', 'standings', { where: x.bool(true) }))).toEqual(['expr_arity@']);
    expect(issuesOf(x.agg('any', 'standings'))).toEqual(['expr_arity@']);
    expect(issuesOf(x.agg('count', 'standings', { of: x.num(1) }))).toEqual(['expr_arity@/of']);
    expect(issuesOf(x.agg('any', 'standings', { of: x.num(1), where: x.bool(true) }))).toEqual(['expr_arity@/of']);
  });

  it('expr_number_range', () => {
    expect(issuesOf(x.num(1e9))).toEqual([]);
    expect(issuesOf(x.num(-1e9))).toEqual([]);
    expect(issuesOf(x.num(1e9 + 1))).toEqual(['expr_number_range@/v']);
    expect(issuesOf(x.num(-1e9 - 1))).toEqual(['expr_number_range@/v']);
    expect(issuesOf(x.num(Number.NaN))).toEqual(['expr_number_range@/v']);
    expect(issuesOf(x.num(Number.POSITIVE_INFINITY))).toEqual(['expr_number_range@/v']);
    expect(issuesOf(x.round(x.num(1), 6))).toEqual([]);
    expect(issuesOf(x.round(x.num(1), 7))).toEqual(['expr_number_range@/digits']);
    expect(issuesOf(x.round(x.num(1), -1))).toEqual(['expr_number_range@/digits']);
    expect(issuesOf(x.inSet(x.num(1), [2e9]))).toEqual(['expr_number_range@/set/0']);
  });

  it('expr_string_length', () => {
    expect(issuesOf(x.str('x'.repeat(64)))).toEqual([]);
    expect(issuesOf(x.str('x'.repeat(65)))).toEqual(['expr_string_length@/v']);
    expect(issuesOf(x.inSet(x.ref('tag', 'text'), ['x'.repeat(65)]))).toEqual(['expr_string_length@/set/0']);
  });

  it('expr_item_scope', () => {
    expect(issuesOf(x.agg('sum', 'standings', { of: x.item('points') }))).toEqual([]);
    expect(issuesOf(x.item('points'))).toEqual(['expr_item_scope@/name']);
    expect(issuesOf(x.arith('+', x.num(1), x.item('points')))).toEqual(['expr_item_scope@/b/name']);
    expect(issuesOf(x.agg('sum', 'standings', { of: x.ref('other.points') }))).toEqual(['expr_item_scope@/of/name']);
    expect(issuesOf(x.agg('sum', 'standings', { of: x.ref('item.a.b') }))).toEqual(['expr_unknown_ref@/of/name']);
  });

  it('expr_nested_aggregate', () => {
    const inner = x.agg('count', 'players');
    expect(issuesOf(x.agg('count', 'standings'))).toEqual([]);
    expect(issuesOf(x.agg('sum', 'standings', { of: inner }))).toEqual(['expr_nested_aggregate@/of']);
    expect(issuesOf(x.agg('any', 'standings', { where: x.cmp('>', inner, x.num(1)) }))).toEqual(['expr_nested_aggregate@/where/a']);
  });
});

describe('typeCheck: reporting', () => {
  it('collects every issue with exact pointers, not just the first', () => {
    const e = x.fn('max', x.num(1), x.arith('+', x.num(2), x.bool(true)), x.ref('nope'), x.str('x'.repeat(65)));
    expect(typeCheck(e, TEST_ENV)).toEqual({
      ok: false,
      issues: [
        { code: 'expr_type_mismatch', pointer: '/args/1/b', params: { expected: 'number', actual: 'boolean' } },
        { code: 'expr_unknown_ref', pointer: '/args/2/name', params: { name: 'nope' } },
        { code: 'expr_string_length', pointer: '/args/3/v', params: { length: 65, limit: 64 } },
        { code: 'expr_type_mismatch', pointer: '/args/3', params: { expected: 'number', actual: 'text' } },
      ],
    });
  });

  it('caps the report at 20 issues', () => {
    const bad = x.fn('max', ...Array.from({ length: 8 }, () => x.arith('+', x.ref('nope'), x.ref('nope'))));
    const result = typeCheck(x.cmp('<', bad, bad), TEST_ENV);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toHaveLength(MAX_TYPECHECK_ISSUES);
  });

  it('boolean vs number result type', () => {
    expect(issuesOf(x.cmp('<', x.num(1), x.num(2)), TEST_ENV, 'number')).toEqual(['expr_result_type@']);
    expect(issuesOf(x.arith('+', x.num(1), x.num(2)), TEST_ENV, 'boolean')).toEqual(['expr_result_type@']);
  });

  it('carries only codes and params, no prose', () => {
    const result = typeCheck(x.arith('+', x.ref('nope'), x.bool(true)), TEST_ENV, 'boolean');
    expect(JSON.stringify(result)).not.toMatch(/\s(is|must|should|expected a)\s/);
  });
});

describe('typeCheck: hostile trees', () => {
  it('rejects a 100000-deep tree with expr_depth, without overflowing the stack', () => {
    let deep = x.num(1);
    for (let i = 0; i < 100_000; i += 1) deep = x.neg(deep);
    expect(issuesOf(deep)).toEqual(['expr_depth@']);
  });

  it('rejects cyclic and huge-fan-out trees', () => {
    const cyclic: Record<string, unknown> = { k: 'neg' };
    cyclic.a = cyclic;
    expect(issuesOf(cyclic)).toEqual(['expr_depth@']);
    expect(issuesOf({ k: 'and', args: new Array(1_000_000).fill(x.bool(true)) })).toEqual(['expr_nodes@']);
  });

  it('reports undefined children and throwing getters as expr_shape', () => {
    expect(issuesOf({ k: 'arith', op: '+', a: undefined, b: x.num(1) })).toEqual(['expr_shape@/a']);
    const trap = { k: 'neg', get a(): never { throw new Error('boom'); } };
    expect(issuesOf(trap)).toEqual(['expr_shape@']);
  });
});
