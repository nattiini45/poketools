import { describe, expect, it } from 'vitest';
import type { EvalContext, Expr, ExprType, ExprValue } from '../ast';
import { x } from '../../test-utils/gen-expr';
import { evaluate, roundHalfAwayFromZero } from '../eval';
import { seededRand } from '../rand';

const row = (entries: Record<string, ExprValue>): ReadonlyMap<string, ExprValue> => new Map(Object.entries(entries));

function makeCtx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    refs: new Map<string, ExprValue>([
      ['points', 7],
      ['wins', 3],
      ['tag', 'x'],
      ['is_seed', true],
    ]),
    collections: new Map([
      [
        'standings',
        [
          row({ points: 9, name: 'ann', active: true }),
          row({ points: 4, name: 'bob', active: false }),
          row({ points: 6, name: 'cat', active: true }),
        ],
      ],
      ['empty', []],
    ]),
    relations: new Map([['same_group', (a: string, b: string) => a[0] === b[0]]]),
    seed: 'season-1',
    scope: 'stage:league',
    ...overrides,
  };
}

function run(e: unknown, expected?: ExprType, ctx: EvalContext = makeCtx()) {
  return evaluate(e as Expr, ctx, expected);
}

function value(e: unknown, ctx?: EvalContext): ExprValue {
  const result = run(e, undefined, ctx);
  if (!result.ok) throw new Error(`evaluation failed: ${JSON.stringify(result.issue)}`);
  return result.value;
}

function code(e: unknown, ctx?: EvalContext, expected?: ExprType): string {
  const result = run(e, expected, ctx);
  return result.ok ? 'ok' : `${result.issue.code}@${result.issue.pointer}`;
}

const rowsOf = (n: number, field = 'v'): ReadonlyMap<string, ExprValue>[] => Array.from({ length: n }, () => row({ [field]: 1 }));

describe('arithmetic', () => {
  it('evaluates the basic operators and reports steps', () => {
    expect(run(x.arith('+', x.num(1), x.num(2)))).toEqual({ ok: true, value: 3, steps: 3 });
    expect(value(x.arith('-', x.num(1), x.num(2)))).toBe(-1);
    expect(value(x.arith('*', x.num(3), x.num(4)))).toBe(12);
    expect(value(x.arith('/', x.num(7), x.num(2)))).toBe(3.5);
    expect(value(x.neg(x.ref('points')))).toBe(-7);
  });

  it('division by zero is 0', () => {
    expect(value(x.arith('/', x.num(5), x.num(0)))).toBe(0);
    expect(value(x.arith('/', x.num(-5), x.arith('-', x.num(1), x.num(1))))).toBe(0);
    expect(value(x.arith('/', x.num(0), x.num(0)))).toBe(0);
  });

  it('never yields -0', () => {
    for (const e of [x.neg(x.num(0)), x.arith('*', x.num(-1), x.num(0)), x.arith('/', x.num(0), x.num(-3)), x.round(x.num(-0.0000001), 3)]) {
      expect(Object.is(value(e), 0)).toBe(true);
    }
  });

  it('min and max take every argument', () => {
    expect(value(x.fn('min', x.num(3), x.num(1), x.num(2)))).toBe(1);
    expect(value(x.fn('max', x.num(3), x.num(1), x.num(2)))).toBe(3);
  });

  it('clamp: lo wins when lo > hi', () => {
    expect(value(x.clamp(x.num(5), x.num(0), x.num(3)))).toBe(3);
    expect(value(x.clamp(x.num(-1), x.num(0), x.num(3)))).toBe(0);
    expect(value(x.clamp(x.num(2), x.num(0), x.num(3)))).toBe(2);
    expect(value(x.clamp(x.num(5), x.num(10), x.num(3)))).toBe(10);
    expect(value(x.clamp(x.num(-5), x.num(10), x.num(3)))).toBe(10);
  });
});

describe('round: half away from zero', () => {
  it.each([
    [0.5, 1],
    [-0.5, -1],
    [1.5, 2],
    [-1.5, -2],
    [2.5, 3],
    [-2.5, -3],
    [0.4, 0],
    [-0.4, 0],
    [1e9, 1e9],
  ])('round(%d) = %d', (input, expected) => {
    expect(value(x.round(x.num(input), 0))).toBe(expected);
  });

  it.each([
    [1.005, 2, 1.01], // x * 100 would be 100.49999999999999
    [-1.005, 2, -1.01],
    [2.675, 2, 2.68],
    [1234.5678, 3, 1234.568],
    [0.125, 2, 0.13],
    [-0.125, 2, -0.13],
    [5e-7, 6, 1e-6],
    [-5e-7, 6, -1e-6],
    [4e-7, 6, 0],
    [0.49999999999999994, 0, 0], // Math.floor(x + 0.5) would give 1
    [999999999.5, 0, 1e9],
    [1.23456789, 6, 1.234568],
    [2.5, 6, 2.5],
  ])('round(%d, %d) = %d', (input, digits, expected) => {
    expect(value(x.round(x.num(input), digits))).toBe(expected);
    expect(roundHalfAwayFromZero(input, digits)).toBe(expected);
  });

  it('differs from Math.round on negative halves', () => {
    expect(Math.round(-0.5)).toBe(-0);
    expect(value(x.round(x.num(-0.5), 0))).toBe(-1);
  });

  it('rejects digits outside 0..6 at run time', () => {
    expect(code({ k: 'round', x: x.num(1), digits: 7 })).toBe('expr_number_range@/digits');
    expect(code({ k: 'round', x: x.num(1), digits: 1.5 })).toBe('expr_shape@/digits');
  });
});

describe('number range', () => {
  it('literals and results must stay within +-1e9', () => {
    expect(value(x.num(1e9))).toBe(1e9);
    expect(code(x.num(1e9 + 1))).toBe('expr_number_range@/v');
    expect(code(x.num(Number.NaN))).toBe('expr_number_range@/v');
    expect(code(x.arith('+', x.num(1e9), x.num(1)))).toBe('expr_number_range@');
    expect(code(x.arith('*', x.num(999_999_999), x.num(2)))).toBe('expr_number_range@');
    expect(value(x.arith('+', x.num(999_999_999), x.num(1)))).toBe(1e9);
    expect(code(x.neg(x.num(-1e9 - 1)))).toBe('expr_number_range@/a/v');
  });

  it('intermediate values are checked too', () => {
    // 999999999 * 2 - 999999999 is in range, but the product is not.
    expect(code(x.arith('-', x.arith('*', x.num(999_999_999), x.num(2)), x.num(999_999_999)))).toBe('expr_number_range@/a');
    expect(code(x.clamp(x.arith('+', x.num(1e9), x.num(1)), x.num(0), x.num(1)))).toBe('expr_number_range@/x');
  });

  it('ref values from the context are checked as well', () => {
    const ctx = makeCtx({ refs: new Map<string, ExprValue>([['points', Number.POSITIVE_INFINITY], ['wins', 2e9]]) });
    expect(code(x.ref('points'), ctx)).toBe('expr_number_range@/name');
    expect(code(x.ref('wins'), ctx)).toBe('expr_number_range@/name');
  });
});

describe('booleans, comparison, in, rel, rand', () => {
  it('compares numbers and compares text by == and != only', () => {
    expect(value(x.cmp('<', x.num(1), x.num(2)))).toBe(true);
    expect(value(x.cmp('<=', x.num(2), x.num(2)))).toBe(true);
    expect(value(x.cmp('>', x.num(1), x.num(2)))).toBe(false);
    expect(value(x.cmp('>=', x.num(1), x.num(2)))).toBe(false);
    expect(value(x.cmp('==', x.str('a'), x.str('a')))).toBe(true);
    expect(value(x.cmp('!=', x.str('a'), x.str('A')))).toBe(true);
    expect(value(x.cmp('==', x.bool(true), x.bool(true)))).toBe(true);
    expect(value(x.cmp('==', x.str('é'), x.str('é')))).toBe(false); // code units, not normalised text
    expect(code(x.cmp('<', x.str('a'), x.str('b')))).toBe('expr_type_mismatch@/a');
    expect(code(x.cmp('==', x.num(1), x.str('1')))).toBe('expr_type_mismatch@/b');
  });

  it('and / or / not', () => {
    expect(value(x.and(x.bool(true), x.bool(true)))).toBe(true);
    expect(value(x.and(x.bool(true), x.bool(false)))).toBe(false);
    expect(value(x.or(x.bool(false), x.bool(true)))).toBe(true);
    expect(value(x.or(x.bool(false), x.bool(false)))).toBe(false);
    expect(value(x.not(x.bool(false)))).toBe(true);
    expect(code(x.and(x.bool(true), x.num(1)))).toBe('expr_type_mismatch@/args/1');
  });

  it('membership', () => {
    expect(value(x.inSet(x.ref('points'), [1, 7]))).toBe(true);
    expect(value(x.inSet(x.ref('points'), [1, 2]))).toBe(false);
    expect(value(x.inSet(x.ref('tag', 'text'), ['x', 'y']))).toBe(true);
    expect(code({ k: 'in', a: x.num(1), set: ['a'] })).toBe('expr_type_mismatch@/set/0');
    expect(code({ k: 'in', a: x.bool(true), set: [1] })).toBe('expr_type_mismatch@/a');
    expect(code({ k: 'in', a: x.num(1), set: [] })).toBe('expr_arity@/set');
  });

  it('rel calls the context relation; an absent relation or pair is false', () => {
    expect(value(x.rel('same_group', x.str('a1'), x.str('a2')))).toBe(true);
    expect(value(x.rel('same_group', x.str('a1'), x.str('b1')))).toBe(false);
    expect(value(x.rel('unknown', x.str('a'), x.str('a')))).toBe(false);
    const sloppy = makeCtx({ relations: new Map([['r', (() => 1) as unknown as (a: string, b: string) => boolean]]) });
    expect(value(x.rel('r', x.str('a'), x.str('a')), sloppy)).toBe(false);
    expect(code(x.rel('same_group', x.num(1), x.str('a')))).toBe('expr_type_mismatch@/a');
  });

  it('seeded_rand is deterministic and separated by key, seed and scope', () => {
    const a = value(x.rand('a'));
    expect(a).toBe(value(x.rand('a')));
    expect(a).toBe(seededRand('season-1', 'stage:league', 'a'));
    expect(value(x.rand('b'))).not.toBe(a);
    expect(value(x.rand('a'), makeCtx({ seed: 'other' }))).not.toBe(a);
    expect(value(x.rand('a'), makeCtx({ scope: 'other' }))).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(code({ k: 'rand', key: 'Bad Key' })).toBe('expr_shape@/key');
  });
});

describe('refs', () => {
  it('reads plain refs and rejects missing or mistyped ones', () => {
    expect(value(x.ref('points'))).toBe(7);
    expect(value(x.ref('tag', 'text'))).toBe('x');
    expect(value(x.ref('is_seed', 'boolean'))).toBe(true);
    expect(code(x.ref('nope'))).toBe('expr_unknown_ref@/name');
    expect(code(x.ref('points', 'text'))).toBe('expr_ref_type@/t');
    expect(code(x.ref('constructor'))).toBe('expr_unknown_ref@/name');
    const odd = makeCtx({ refs: new Map<string, ExprValue>([['points', { not: 'a value' } as unknown as ExprValue]]) });
    expect(code(x.ref('points'), odd)).toBe('expr_ref_type@/t');
  });

  it('item refs only exist inside an aggregate', () => {
    expect(code(x.item('points'))).toBe('expr_item_scope@/name');
    expect(code(x.agg('sum', 'standings', { of: x.ref('other.points') }))).toBe('expr_item_scope@/of/name');
    expect(code(x.agg('sum', 'standings', { of: x.item('nope') }))).toBe('expr_unknown_field@/of/name');
    expect(code(x.agg('sum', 'standings', { of: x.item('name', 'text') }))).toBe('expr_type_mismatch@/of');
    expect(code(x.agg('sum', 'standings', { of: x.item('points', 'text') }))).toBe('expr_ref_type@/of/t');
  });
});

describe('if and short-circuit step accounting', () => {
  it('evaluates one branch and charges only for the nodes visited', () => {
    const big = x.nodes(50);
    const chosen = run(x.ifx(x.bool(true), x.num(1), big));
    expect(chosen).toEqual({ ok: true, value: 1, steps: 3 }); // if, cond, then
    const other = run(x.ifx(x.bool(false), big, x.num(2)));
    expect(other).toEqual({ ok: true, value: 2, steps: 3 });
  });

  it('and / or stop at the deciding operand', () => {
    const big = x.cmp('>', x.nodes(50), x.num(0));
    expect(run(x.and(x.bool(false), big))).toEqual({ ok: true, value: false, steps: 2 });
    expect(run(x.or(x.bool(true), big))).toEqual({ ok: true, value: true, steps: 2 });
    expect(run(x.and(x.bool(true), x.bool(true), x.bool(true)))).toMatchObject({ steps: 4 });
  });

  it('a type error in a branch that is not taken is not seen', () => {
    expect(value(x.ifx(x.bool(true), x.num(1), x.str('a')))).toBe(1);
  });
});

describe('aggregates', () => {
  const where = (e: Expr) => ({ where: e });
  const hasPoints = x.cmp('>', x.item('points'), x.num(5));

  it('count / sum / min / max over rows, with and without where', () => {
    expect(value(x.agg('count', 'standings'))).toBe(3);
    expect(value(x.agg('count', 'standings', where(hasPoints)))).toBe(2);
    expect(value(x.agg('sum', 'standings', { of: x.item('points') }))).toBe(19);
    expect(value(x.agg('sum', 'standings', { of: x.item('points'), ...where(hasPoints) }))).toBe(15);
    expect(value(x.agg('min', 'standings', { of: x.item('points') }))).toBe(4);
    expect(value(x.agg('max', 'standings', { of: x.item('points') }))).toBe(9);
    expect(value(x.agg('max', 'standings', { of: x.arith('*', x.item('points'), x.ref('wins')), ...where(x.item('active', 'boolean')) }))).toBe(27);
    expect(value(x.agg('min', 'standings', { of: x.item('points'), ...where(x.item('active', 'boolean')) }))).toBe(6);
  });

  it('any / all', () => {
    expect(value(x.agg('any', 'standings', where(hasPoints)))).toBe(true);
    expect(value(x.agg('any', 'standings', where(x.cmp('>', x.item('points'), x.num(50)))))).toBe(false);
    expect(value(x.agg('all', 'standings', where(x.cmp('>', x.item('points'), x.num(3)))))).toBe(true);
    expect(value(x.agg('all', 'standings', where(hasPoints)))).toBe(false);
  });

  it('empty collections: everything is 0, any is false, all is true', () => {
    expect(value(x.agg('count', 'empty'))).toBe(0);
    expect(value(x.agg('sum', 'empty', { of: x.item('v') }))).toBe(0);
    expect(value(x.agg('min', 'empty', { of: x.item('v') }))).toBe(0);
    expect(value(x.agg('max', 'empty', { of: x.item('v') }))).toBe(0);
    expect(value(x.agg('any', 'empty', where(x.bool(true))))).toBe(false);
    expect(value(x.agg('all', 'empty', where(x.bool(false))))).toBe(true);
    // A filter that matches nothing behaves like an empty collection.
    const none = where(x.cmp('>', x.item('points'), x.num(100)));
    expect(value(x.agg('max', 'standings', { of: x.item('points'), ...none }))).toBe(0);
    expect(value(x.agg('sum', 'standings', { of: x.item('points'), ...none }))).toBe(0);
  });

  it('charges 1 + the body nodes per row and stops any / all at the deciding row', () => {
    // agg node + 3 rows * (1 + 3 body nodes)
    expect(run(x.agg('count', 'standings', where(hasPoints)))).toEqual({ ok: true, value: 2, steps: 1 + 3 * 4 });
    // sum evaluates where (3 nodes) and, for matching rows, of (1 node)
    expect(run(x.agg('sum', 'standings', { of: x.item('points'), ...where(hasPoints) }))).toEqual({ ok: true, value: 15, steps: 1 + 3 * 4 + 2 * 1 });
    // any: the first row decides (9 > 5): 1 + 1 + 3
    expect(run(x.agg('any', 'standings', where(hasPoints)))).toEqual({ ok: true, value: true, steps: 5 });
    // all: the second row fails (4 > 5 is false): 1 + 2 * 4
    expect(run(x.agg('all', 'standings', where(hasPoints)))).toEqual({ ok: true, value: false, steps: 9 });
  });

  it('rejects unknown collections, bad arity and nesting at run time', () => {
    expect(code(x.agg('count', 'nope'))).toBe('expr_unknown_collection@/over');
    expect(code(x.agg('sum', 'standings'))).toBe('expr_arity@');
    expect(code(x.agg('any', 'standings'))).toBe('expr_arity@');
    expect(code(x.agg('count', 'standings', { of: x.num(1) }))).toBe('expr_arity@/of');
    expect(code(x.agg('sum', 'standings', { of: x.agg('count', 'standings') }))).toBe('expr_nested_aggregate@/of');
    expect(code(x.agg('count', 'standings', where(x.num(1))))).toBe('expr_type_mismatch@/where');
  });

  it('sums in the order the context gives', () => {
    const forward = makeCtx({ collections: new Map([['standings', [row({ points: 1e-9 }), row({ points: 1 }), row({ points: -1 })]]]) });
    const backward = makeCtx({ collections: new Map([['standings', [row({ points: -1 }), row({ points: 1 }), row({ points: 1e-9 })]]]) });
    const sum = x.agg('sum', 'standings', { of: x.item('points') });
    expect(value(sum, forward)).not.toBe(value(sum, backward));
  });

  it('sum overflow is a range error', () => {
    const ctx = makeCtx({ collections: new Map([['standings', [row({ points: 6e8 }), row({ points: 6e8 })]]]) });
    expect(code(x.agg('sum', 'standings', { of: x.item('points') }), ctx)).toBe('expr_number_range@');
  });
});

describe('step budget', () => {
  const big = (n: number): EvalContext => makeCtx({ collections: new Map([['big', rowsOf(n)]]) });

  it('2499 rows of a 1-node body use exactly 5000 steps; one more row exceeds the budget', () => {
    const sum = x.neg(x.agg('sum', 'big', { of: x.item('v') }));
    expect(run(sum, undefined, big(2499))).toEqual({ ok: true, value: -2499, steps: 5000 });
    const over = run(sum, undefined, big(2500));
    expect(over).toMatchObject({ ok: false, steps: 5001 });
    expect(!over.ok && over.issue).toEqual({ code: 'expr_steps', pointer: '', params: { budget: 5000 } });
  });

  it('exceeds at exactly 5001 steps: 1 + 4 * 1250', () => {
    const count = x.agg('count', 'big', { where: x.cmp('>', x.item('v'), x.num(0)) });
    expect(run(count, undefined, big(1249))).toMatchObject({ ok: true, steps: 4997 });
    expect(run(count, undefined, big(1250))).toMatchObject({ ok: false, steps: 5001 });
  });

  it('a huge collection cannot run unbounded work', () => {
    const rows = rowsOf(2_000_000);
    const result = run(x.agg('count', 'big'), undefined, makeCtx({ collections: new Map([['big', rows]]) }));
    expect(result).toMatchObject({ ok: false, steps: 5001 });
  });
});

describe('result type', () => {
  it('is checked against the expected type', () => {
    expect(run(x.num(1), 'number')).toMatchObject({ ok: true });
    expect(code(x.num(1), undefined, 'boolean')).toBe('expr_result_type@');
    expect(code(x.cmp('<', x.num(1), x.num(2)), undefined, 'number')).toBe('expr_result_type@');
    expect(code(x.str('a'), undefined, 'number')).toBe('expr_result_type@');
  });
});

describe('hostile input never throws', () => {
  const hostile: [string, unknown][] = [
    ['unknown kind', { k: 'zzz' }],
    ['not an object', 5],
    ['undefined', undefined],
    ['null', null],
    ['undefined child', { k: 'arith', op: '+', a: undefined, b: x.num(1) }],
    ['bad operator', { k: 'arith', op: '^', a: x.num(1), b: x.num(2) }],
    ['bad comparison', { k: 'cmp', op: '~', a: x.num(1), b: x.num(2) }],
    ['args not an array', { k: 'fn', fn: 'min', args: 5 }],
    ['bad function', { k: 'fn', fn: 'avg', args: [x.num(1), x.num(2)] }],
    ['arity 1', { k: 'and', args: [x.bool(true)] }],
    ['num with a string', { k: 'num', v: '1' }],
    ['bool with a number', { k: 'bool', v: 1 }],
    ['str with a number', { k: 'str', v: 1 }],
    ['string too long', x.str('x'.repeat(65))],
    ['ref without a name', { k: 'ref', t: 'number' }],
    ['ref with a bad type', { k: 'ref', name: 'points', t: 'int' }],
    ['rel without a name', { k: 'rel', a: x.str('a'), b: x.str('b') }],
    ['in without a set', { k: 'in', a: x.num(1) }],
    ['agg without fn', { k: 'agg', over: 'standings' }],
    ['agg without over', { k: 'agg', fn: 'count' }],
    ['getter that throws', { k: 'neg', get a(): never { throw new Error('boom'); } }],
  ];

  it.each(hostile)('%s returns an issue', (_name, e) => {
    const result = run(e);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toMatch(/^expr_/);
  });

  it('a cyclic object is a depth issue', () => {
    const cyclic: Record<string, unknown> = { k: 'neg' };
    cyclic.a = cyclic;
    expect(run(cyclic)).toMatchObject({ ok: false, issue: { code: 'expr_depth' }, steps: 0 });
  });

  it('a 100000-deep tree is rejected with expr_depth', () => {
    let deep = x.num(1);
    for (let i = 0; i < 100_000; i += 1) deep = x.neg(deep);
    expect(run(deep)).toMatchObject({ ok: false, issue: { code: 'expr_depth' } });
  });

  it('more than 200 nodes is rejected before evaluating', () => {
    expect(run(x.nodes(201))).toMatchObject({ ok: false, issue: { code: 'expr_nodes' }, steps: 0 });
    expect(run(x.nodes(200))).toMatchObject({ ok: true });
  });

  it('a throwing relation function is an issue, not an exception', () => {
    const ctx = makeCtx({
      relations: new Map([
        [
          'boom',
          () => {
            throw new Error('boom');
          },
        ],
      ]),
    });
    expect(run(x.rel('boom', x.str('a'), x.str('b')), undefined, ctx)).toMatchObject({ ok: false });
  });

  it('issues carry codes and params only', () => {
    const result = run(x.arith('+', x.ref('nope'), x.num(1)));
    expect(result).toEqual({ ok: false, issue: { code: 'expr_unknown_ref', pointer: '/a/name', params: { name: 'nope' } }, steps: 2 });
  });
});
