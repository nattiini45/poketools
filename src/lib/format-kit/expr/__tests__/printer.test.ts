import { describe, expect, it } from 'vitest';
import type { Expr } from '../ast';
import { TEST_ENV, x } from '../../test-utils/gen-expr';
import { normalizeExpr } from '../normalize';
import { parseExpr } from '../parser';
import { formatNumber, formatString, printExpr } from '../printer';

const p = x.ref('points');
const w = x.ref('wins');
const l = x.ref('losses');
const s = x.ref('is_seed', 'boolean');

function reparse(source: string): Expr {
  const result = parseExpr(source, TEST_ENV);
  if (!result.ok) throw new Error(`reparse failed for ${source}: ${JSON.stringify(result.issues)}`);
  return result.expr;
}

describe('printExpr: minimal parentheses', () => {
  it.each([
    [x.arith('*', x.arith('+', p, w), l), '(points + wins) * losses'],
    [x.arith('+', p, x.arith('*', w, l)), 'points + wins * losses'],
    [x.arith('-', p, x.arith('-', w, l)), 'points - (wins - losses)'],
    [x.arith('-', x.arith('-', p, w), l), 'points - wins - losses'],
    [x.arith('+', p, x.arith('+', w, l)), 'points + (wins + losses)'],
    [x.arith('/', p, x.arith('*', w, l)), 'points / (wins * losses)'],
    [x.arith('/', x.arith('*', p, w), l), 'points * wins / losses'],
    [x.neg(x.arith('+', p, w)), '-(points + wins)'],
    [x.neg(p), '-points'],
    [x.neg(x.neg(p)), '-(-points)'],
    [x.arith('*', x.num(-2), x.num(3)), '-2 * 3'],
    [x.arith('-', p, x.num(-3)), 'points - -3'],
    [x.arith('*', p, x.num(-3)), 'points * -3'],
    [x.arith('*', p, x.neg(w)), 'points * -wins'],
    [x.arith('*', x.neg(p), w), '-points * wins'],
    [x.and(x.not(s), s), 'not is_seed and is_seed'],
    [x.not(x.and(s, s)), 'not (is_seed and is_seed)'],
    [x.not(x.not(s)), 'not not is_seed'],
    [x.not(x.cmp('<', p, x.num(3))), 'not points < 3'],
    [x.and(x.or(s, s), s), '(is_seed or is_seed) and is_seed'],
    [x.or(x.and(s, s), s), 'is_seed and is_seed or is_seed'],
    [x.and(x.and(s, s), s), '(is_seed and is_seed) and is_seed'],
    [x.cmp('==', x.cmp('<', p, x.num(3)), x.cmp('<', w, x.num(4))), '(points < 3) == (wins < 4)'],
    [x.cmp('<', x.arith('+', p, x.num(1)), x.arith('*', w, x.num(2))), 'points + 1 < wins * 2'],
    [x.cmp('!=', x.not(s), s), '(not is_seed) != is_seed'],
    [x.inSet(x.arith('+', p, x.num(1)), [2, -3]), 'points + 1 in [2, -3]'],
    [x.inSet(x.ref('tag', 'text'), ['a', 'say "hi"', 'b\\c']), 'tag in ["a", "say \\"hi\\"", "b\\\\c"]'],
    [x.cmp('==', x.inSet(p, [1]), s), '(points in [1]) == is_seed'],
    [x.and(x.inSet(p, [1]), s), 'points in [1] and is_seed'],
  ])('%j', (expr, expected) => {
    expect(printExpr(expr)).toBe(expected);
  });

  it('prints every call and aggregate form', () => {
    expect(printExpr(x.fn('min', x.num(1), x.num(2), x.num(3)))).toBe('min(1, 2, 3)');
    expect(printExpr(x.clamp(p, x.num(0), x.num(10)))).toBe('clamp(points, 0, 10)');
    expect(printExpr(x.round(p, 0))).toBe('round(points)');
    expect(printExpr(x.round(x.arith('/', p, x.num(3)), 2))).toBe('round(points / 3, 2)');
    expect(printExpr(x.ifx(s, x.num(1), x.num(2)))).toBe('if(is_seed, 1, 2)');
    expect(printExpr(x.rel('same_group', x.ref('tag', 'text'), x.str('x')))).toBe('rel(same_group, tag, "x")');
    expect(printExpr(x.rand('coin'))).toBe('seeded_rand(coin)');
    expect(printExpr(x.agg('count', 'standings'))).toBe('count(standings)');
    expect(printExpr(x.agg('count', 'standings', { where: x.cmp('>', x.item('points'), x.num(1)) }))).toBe('count(standings where item.points > 1)');
    expect(printExpr(x.agg('min', 'standings', { of: x.item('points'), where: x.item('active', 'boolean') }))).toBe(
      'min(standings of item.points where item.active)',
    );
    expect(printExpr(x.neg(x.agg('sum', 'standings', { of: x.item('points') })))).toBe('-sum(standings of item.points)');
    expect(printExpr(x.bool(true))).toBe('true');
    expect(printExpr(x.bool(false))).toBe('false');
  });

  it('formats numbers canonically', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(1e9)).toBe('1000000000');
    expect(formatNumber(0.1)).toBe('0.1');
    expect(formatNumber(1.005)).toBe('1.005');
    expect(formatNumber(1e-7)).toBe('1e-7');
    expect(formatNumber(1.5e-7)).toBe('1.5e-7');
    expect(formatNumber(-2.5)).toBe('-2.5');
    expect(formatNumber(1e21)).toBe('1e21'); // never "1e+21"
    expect(formatNumber(123456.789)).toBe('123456.789');
  });

  it('escapes only quote and backslash', () => {
    expect(formatString('a')).toBe('"a"');
    expect(formatString('say "hi"')).toBe('"say \\"hi\\""');
    expect(formatString('a\\b')).toBe('"a\\\\b"');
    expect(formatString('tab\there')).toBe('"tab\there"');
  });

  it('does not overflow the stack on a very deep tree', () => {
    let deep = x.num(1);
    for (let i = 0; i < 20_000; i += 1) deep = x.neg(deep);
    expect(printExpr(deep).length).toBeGreaterThan(20_000);
  });
});

describe('print then parse', () => {
  const samples: Expr[] = [
    x.arith('-', p, x.arith('-', w, l)),
    x.arith('*', x.num(-2), x.arith('+', p, x.num(1.5))),
    x.neg(x.neg(p)),
    x.and(x.or(s, s), x.not(x.cmp('<', p, x.num(3))), s),
    x.cmp('==', x.cmp('<', p, x.num(3)), x.bool(false)),
    x.inSet(x.arith('/', p, x.num(2)), [1, -2, 3.5]),
    x.ifx(x.inSet(x.ref('tag', 'text'), ['a']), x.round(p, 3), x.clamp(w, x.num(0), x.num(1e9))),
    x.agg('max', 'standings', { of: x.arith('+', x.item('points'), x.item('wins')), where: x.not(x.item('active', 'boolean')) }),
    x.fn('max', x.rand('coin'), x.num(1e-7), x.num(-1e9)),
    x.rel('played', x.str('say "hi"'), x.ref('label', 'text')),
    x.and(x.and(...Array.from({ length: 8 }, () => s)), s),
  ];

  it('round-trips to the normalized original', () => {
    for (const sample of samples) {
      expect(reparse(printExpr(sample))).toEqual(normalizeExpr(sample));
    }
  });

  it('printing is a fixed point through a parse', () => {
    for (const sample of samples.map(normalizeExpr)) {
      const text = printExpr(sample);
      expect(printExpr(reparse(text))).toBe(text);
    }
  });
});

describe('normalizeExpr', () => {
  it('folds neg(num) and never produces -0', () => {
    expect(normalizeExpr(x.neg(x.num(5)))).toEqual(x.num(-5));
    expect(normalizeExpr(x.neg(x.num(-5)))).toEqual(x.num(5));
    const zero = normalizeExpr(x.neg(x.num(0)));
    expect(Object.is((zero as { v: number }).v, 0)).toBe(true);
    expect(normalizeExpr(x.neg(x.neg(x.num(5))))).toEqual(x.num(5));
    expect(normalizeExpr(x.neg(x.neg(p)))).toEqual(x.neg(x.neg(p)));
    expect(normalizeExpr(x.arith('+', x.neg(x.num(2)), p))).toEqual(x.arith('+', x.num(-2), p));
  });

  it('flattens nested and / or', () => {
    expect(normalizeExpr(x.and(x.and(s, s), s))).toEqual(x.and(s, s, s));
    expect(normalizeExpr(x.and(s, x.and(s, s)))).toEqual(x.and(s, s, s));
    expect(normalizeExpr(x.or(x.or(s, s), x.or(s, s)))).toEqual(x.or(s, s, s, s));
    expect(normalizeExpr(x.and(x.and(x.and(s, s), s), s))).toEqual(x.and(s, s, s, s));
    // Different operators stay nested.
    expect(normalizeExpr(x.and(x.or(s, s), s))).toEqual(x.and(x.or(s, s), s));
  });

  it('keeps nesting that would exceed 8 operands', () => {
    const eight = x.and(...Array.from({ length: 8 }, () => s));
    expect(normalizeExpr(x.and(eight, s))).toEqual(x.and(eight, s));
  });

  it('leaves everything else untouched, is idempotent and does not mutate', () => {
    const input = x.ifx(x.and(x.and(s, s), s), x.neg(x.num(2)), x.agg('sum', 'standings', { of: x.neg(x.num(1)) }));
    const snapshot = JSON.stringify(input);
    const once = normalizeExpr(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(once).toEqual(x.ifx(x.and(s, s, s), x.num(-2), x.agg('sum', 'standings', { of: x.num(-1) })));
    expect(normalizeExpr(once)).toEqual(once);
    const plain = x.cmp('<', p, x.round(w, 2));
    expect(normalizeExpr(plain)).toEqual(plain);
  });

  it('handles a very deep tree iteratively', () => {
    let deep = x.num(1);
    for (let i = 0; i < 100_000; i += 1) deep = x.arith('+', deep, p);
    expect(normalizeExpr(deep).k).toBe('arith');
  });
});
