import { describe, expect, it } from 'vitest';
import type { Expr, ExprIssue } from '../ast';
import { TEST_ENV, x } from '../../test-utils/gen-expr';
import { EXPR_MAX_SOURCE_CHARS } from '../limits';
import { parseExpr } from '../parser';
import { printExpr } from '../printer';
import { typeCheck } from '../typecheck';

function parse(source: string): Expr {
  const result = parseExpr(source, TEST_ENV);
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.issues)}`);
  return result.expr;
}

function failure(source: string): ExprIssue {
  const result = parseExpr(source, TEST_ENV);
  if (result.ok) throw new Error(`expected a parse failure for ${source}`);
  expect(result.issues).toHaveLength(1);
  return result.issues[0];
}

const p = x.ref('points');
const w = x.ref('wins');
const l = x.ref('losses');
const s = x.ref('is_seed', 'boolean');

describe('precedence and associativity', () => {
  it.each([
    ['points - wins - losses', x.arith('-', x.arith('-', p, w), l)],
    ['points + wins * losses', x.arith('+', p, x.arith('*', w, l))],
    ['1 + 2 * 3', x.arith('+', x.num(1), x.arith('*', x.num(2), x.num(3)))],
    ['(1 + 2) * 3', x.arith('*', x.arith('+', x.num(1), x.num(2)), x.num(3))],
    ['points / wins / losses', x.arith('/', x.arith('/', p, w), l)],
    ['points - (wins - losses)', x.arith('-', p, x.arith('-', w, l))],
    ['-2 * 3', x.arith('*', x.num(-2), x.num(3))],
    ['-points * wins', x.arith('*', x.neg(p), w)],
    ['- - 5', x.num(5)],
    ['2 - -3', x.arith('-', x.num(2), x.num(-3))],
    ['2 * -3', x.arith('*', x.num(2), x.num(-3))],
    ['-(1 + 2)', x.neg(x.arith('+', x.num(1), x.num(2)))],
    ['not is_seed and is_seed', x.and(x.not(s), s)],
    ['not (is_seed and is_seed)', x.not(x.and(s, s))],
    ['not not is_seed', x.not(x.not(s))],
    ['not points < 3', x.not(x.cmp('<', p, x.num(3)))],
    ['is_seed or is_seed and is_seed', x.or(s, x.and(s, s))],
    ['is_seed and is_seed or is_seed', x.or(x.and(s, s), s)],
    ['is_seed and is_seed and is_seed', x.and(s, s, s)],
    ['(is_seed and is_seed) and is_seed', x.and(s, s, s)],
    ['is_seed and (is_seed and is_seed)', x.and(s, s, s)],
    ['points + 1 < wins * 2', x.cmp('<', x.arith('+', p, x.num(1)), x.arith('*', w, x.num(2)))],
    ['points >= 3 and wins != 2', x.and(x.cmp('>=', p, x.num(3)), x.cmp('!=', w, x.num(2)))],
    ['(points < 3) == (wins < 4)', x.cmp('==', x.cmp('<', p, x.num(3)), x.cmp('<', w, x.num(4)))],
    ['points + 1 in [2, 3]', x.inSet(x.arith('+', p, x.num(1)), [2, 3])],
    ['points in [1] and is_seed', x.and(x.inSet(p, [1]), s)],
  ])('%s', (source, expected) => {
    expect(parse(source)).toEqual(expected);
  });

  it('comparison and `in` are non-associative', () => {
    expect(failure('1 < 2 < 3')).toMatchObject({ code: 'expr_parse', params: { offset: 6 } });
    expect(failure('1 == 2 == 3')).toMatchObject({ code: 'expr_parse', params: { offset: 7 } });
    expect(failure('points in [1] == true')).toMatchObject({ code: 'expr_parse' });
    expect(parse('(1 < 2) == true')).toEqual(x.cmp('==', x.cmp('<', x.num(1), x.num(2)), x.bool(true)));
  });

  it('folds a leading minus into the literal and never makes -0', () => {
    const zero = parse('-0');
    expect(zero).toEqual(x.num(0));
    expect(Object.is((zero as { v: number }).v, 0)).toBe(true);
    expect(parse('-5')).toEqual(x.num(-5));
    expect(parse('-points')).toEqual(x.neg(p));
  });

  it('does not nest and/or nodes beyond the argument limit', () => {
    const eight = Array.from({ length: 8 }, () => 'is_seed').join(' and ');
    expect(parse(eight)).toMatchObject({ k: 'and' });
    expect(failure(Array.from({ length: 9 }, () => 'is_seed').join(' and '))).toMatchObject({ code: 'expr_arity' });
    // (8 operands) and one more is kept nested: flattening would give 9.
    expect(parse(`(${eight}) and is_seed`)).toEqual(x.and(x.and(...Array.from({ length: 8 }, () => s)), s));
  });
});

describe('literals', () => {
  it('numbers: digits, fraction, exponent', () => {
    expect(parse('0')).toEqual(x.num(0));
    expect(parse('12')).toEqual(x.num(12));
    expect(parse('0.25')).toEqual(x.num(0.25));
    expect(parse('1e3')).toEqual(x.num(1000));
    expect(parse('2.5e-3')).toEqual(x.num(0.0025));
    expect(parse('1e+2')).toEqual(x.num(100));
    expect(parse('1e9')).toEqual(x.num(1e9));
    expect(parse('1e-7')).toEqual(x.num(1e-7));
    expect(parse('0.1 + 0.2')).toEqual(x.arith('+', x.num(0.1), x.num(0.2)));
  });

  it('strings: only \\" and \\\\ are escapes', () => {
    expect(parse('"a b"')).toEqual(x.str('a b'));
    expect(parse('"say \\"hi\\""')).toEqual(x.str('say "hi"'));
    expect(parse('"back\\\\slash"')).toEqual(x.str('back\\slash'));
    expect(parse('""')).toEqual(x.str(''));
    expect(parse('"ünï"')).toEqual(x.str('ünï'));
    expect(failure('"a\\nb"')).toMatchObject({ code: 'expr_parse', params: { offset: 2, expected: 'escape' } });
  });

  it('booleans and whitespace', () => {
    expect(parse('true')).toEqual(x.bool(true));
    expect(parse('  false\n')).toEqual(x.bool(false));
    expect(parse('1\t+\r\n2')).toEqual(x.arith('+', x.num(1), x.num(2)));
  });

  it('literals out of range are reported at their offset', () => {
    expect(failure('1 + 1e999')).toMatchObject({ code: 'expr_number_range', params: { offset: 4 } });
    expect(failure('2000000000')).toMatchObject({ code: 'expr_number_range', params: { offset: 0 } });
    expect(failure('-2000000000')).toMatchObject({ code: 'expr_number_range', params: { offset: 1 } });
    expect(failure(`"${'x'.repeat(65)}"`)).toMatchObject({ code: 'expr_string_length', params: { offset: 0, length: 65 } });
    expect(parse(`"${'x'.repeat(64)}"`)).toEqual(x.str('x'.repeat(64)));
  });
});

describe('calls and aggregates', () => {
  it('every call form', () => {
    expect(parse('min(1, 2, 3)')).toEqual(x.fn('min', x.num(1), x.num(2), x.num(3)));
    expect(parse('max(points, wins)')).toEqual(x.fn('max', p, w));
    expect(parse('clamp(points, 0, 10)')).toEqual(x.clamp(p, x.num(0), x.num(10)));
    expect(parse('round(points)')).toEqual(x.round(p, 0));
    expect(parse('round(points, 2)')).toEqual(x.round(p, 2));
    expect(parse('round(points / 3, 6)')).toEqual(x.round(x.arith('/', p, x.num(3)), 6));
    expect(parse('if(is_seed, 1, 2)')).toEqual(x.ifx(s, x.num(1), x.num(2)));
    expect(parse('rel(same_group, tag, "x")')).toEqual(x.rel('same_group', x.ref('tag', 'text'), x.str('x')));
    expect(parse('seeded_rand(coin)')).toEqual(x.rand('coin'));
    expect(parse('max(1, 2, 3, 4, 5, 6, 7, 8)')).toMatchObject({ k: 'fn' });
  });

  it('every aggregate form', () => {
    expect(parse('count(standings)')).toEqual(x.agg('count', 'standings'));
    expect(parse('count(standings where item.points > 1)')).toEqual(x.agg('count', 'standings', { where: x.cmp('>', x.item('points'), x.num(1)) }));
    expect(parse('sum(standings of item.points)')).toEqual(x.agg('sum', 'standings', { of: x.item('points') }));
    expect(parse('min(standings of item.points where item.active)')).toEqual(
      x.agg('min', 'standings', { of: x.item('points'), where: x.item('active', 'boolean') }),
    );
    expect(parse('max(standings of item.points + 1)')).toEqual(x.agg('max', 'standings', { of: x.arith('+', x.item('points'), x.num(1)) }));
    expect(parse('any(players where item.rating > points)')).toEqual(x.agg('any', 'players', { where: x.cmp('>', x.item('rating'), p) }));
    expect(parse('all(players where item.group == "a" or item.rating > 3)')).toMatchObject({ k: 'agg', fn: 'all', where: { k: 'or' } });
    expect(parse('sum(standings of item.points) / count(standings)')).toMatchObject({ k: 'arith', op: '/' });
  });

  it('tells an aggregate min/max from the n-ary call', () => {
    expect(parse('min(standings of item.points)')).toMatchObject({ k: 'agg', fn: 'min' });
    expect(parse('max(standings where item.active)')).toMatchObject({ k: 'agg', fn: 'max' });
    expect(parse('max(standings)')).toMatchObject({ k: 'agg', fn: 'max', over: 'standings' });
    expect(parse('min(points, wins)')).toMatchObject({ k: 'fn', fn: 'min' });
    // A collection name only counts when followed by of / where / ).
    expect(failure('min(points)')).toMatchObject({ code: 'expr_parse', params: { offset: 10, expected: ',' } });
    expect(failure('min(players, 1)')).toMatchObject({ code: 'expr_unknown_ref', params: { offset: 4, name: 'players' } });
  });

  it('keeps aggregate bodies scoped to their collection', () => {
    expect(failure('item.points')).toMatchObject({ code: 'expr_item_scope', params: { offset: 0 } });
    expect(failure('count(standings where other.points > 1)')).toMatchObject({ code: 'expr_item_scope', params: { offset: 22 } });
    expect(failure('sum(standings of item.rating)')).toMatchObject({ code: 'expr_unknown_field', params: { offset: 17 } });
    expect(failure('count(nope)')).toMatchObject({ code: 'expr_unknown_collection', params: { offset: 6, over: 'nope' } });
    expect(failure('sum(standings of count(players))')).toMatchObject({ code: 'expr_nested_aggregate', params: { offset: 17 } });
    // The scope ends with the aggregate.
    expect(failure('count(standings) + item.points')).toMatchObject({ code: 'expr_item_scope' });
  });

  it('x in [...] with numbers, negatives and strings', () => {
    expect(parse('points in [1, 2, 3]')).toEqual(x.inSet(p, [1, 2, 3]));
    expect(parse('points in [-1, 0, -0]')).toEqual(x.inSet(p, [-1, 0, 0]));
    expect(parse('tag in ["a", "b c"]')).toEqual(x.inSet(x.ref('tag', 'text'), ['a', 'b c']));
    expect(failure('points in []')).toMatchObject({ code: 'expr_parse', params: { expected: 'literal' } });
    expect(failure('points in [points]')).toMatchObject({ code: 'expr_parse', params: { offset: 11 } });
    expect(failure(`points in [${Array.from({ length: 33 }, (_, i) => i).join(',')}]`)).toMatchObject({ code: 'expr_arity' });
    expect(parse(`points in [${Array.from({ length: 32 }, (_, i) => i).join(',')}]`)).toMatchObject({ k: 'in' });
  });
});

describe('errors are codes with offsets, never prose', () => {
  it.each([
    ['', 'expr_parse', 0, 'expression'],
    ['1 +', 'expr_parse', 3, 'expression'],
    ['1 + * 2', 'expr_parse', 4, 'expression'],
    ['(1', 'expr_parse', 2, ')'],
    ['1)', 'expr_parse', 1, 'end'],
    ['1 2', 'expr_parse', 2, 'end'],
    ['"abc', 'expr_parse', 0, 'quote'],
    ['1 = 2', 'expr_parse', 2, 'token'],
    ['1 ! 2', 'expr_parse', 2, 'token'],
    ['1 $ 2', 'expr_parse', 2, 'token'],
    ['Points', 'expr_parse', 0, 'token'],
    ['12abc', 'expr_parse', 2, 'operator'],
    ['1.', 'expr_parse', 1, 'token'],
    ['.5', 'expr_parse', 0, 'token'],
    ['1e', 'expr_parse', 1, 'operator'],
    ['max(1', 'expr_parse', 5, ','],
    ['max(1,', 'expr_parse', 6, 'expression'],
    ['round(1, x)', 'expr_parse', 9, 'number'],
    ['rel(1, "a", "b")', 'expr_parse', 4, 'key'],
    ['seeded_rand(1)', 'expr_parse', 12, 'key'],
    ['if(true, 1)', 'expr_parse', 10, ','],
  ])('%j -> %s at %i (%s)', (source, code, offset, expected) => {
    const issue = failure(source);
    expect(issue.code).toBe(code);
    expect(issue.pointer).toBe('');
    expect(issue.params).toEqual({ offset, expected });
  });

  it('unknown refs carry the offset and name', () => {
    expect(failure('points + nope')).toEqual({ code: 'expr_unknown_ref', pointer: '', params: { offset: 9, name: 'nope' } });
    // tostring is not a registered ref, whatever Object.prototype says about toString.
    expect(failure('tostring')).toMatchObject({ code: 'expr_unknown_ref', params: { offset: 0, name: 'tostring' } });
    expect(failure('toString')).toMatchObject({ code: 'expr_parse', params: { offset: 2, expected: 'token' } });
    expect(failure('hasownproperty')).toMatchObject({ code: 'expr_unknown_ref' });
    expect(parse('constructor')).toEqual(x.ref('constructor'));
  });

  it('keywords cannot be ref names', () => {
    for (const keyword of ['and', 'or', 'in', 'of', 'where']) {
      expect(failure(`1 + ${keyword}`)).toMatchObject({ code: 'expr_parse', params: { offset: 4, expected: 'expression' } });
    }
    for (const keyword of ['if', 'min', 'max', 'clamp', 'round', 'rel', 'seeded_rand', 'count', 'sum', 'any', 'all']) {
      // A call keyword without its parenthesis is an error at the next token.
      expect(failure(`1 + ${keyword}`)).toMatchObject({ code: 'expr_parse', params: { expected: '(' } });
    }
    expect(failure('not')).toMatchObject({ code: 'expr_parse', params: { offset: 3 } });
    // Even when an env names a ref like a keyword it is not reachable.
    const env = { ...TEST_ENV, refs: new Map([...TEST_ENV.refs, ['where', 'number' as const]]) };
    expect(parseExpr('where + 1', env)).toMatchObject({ ok: false });
  });

  it('source over 2000 characters is rejected up front', () => {
    const atLimit = '1' + ' '.repeat(EXPR_MAX_SOURCE_CHARS - 1);
    expect(parseExpr(atLimit, TEST_ENV)).toEqual({ ok: true, expr: x.num(1) });
    expect(failure(atLimit + ' ')).toEqual({ code: 'expr_source_length', pointer: '', params: { offset: 2000, length: 2001, max: 2000 } });
  });

  it('nesting depth 64 fails with expr_parse instead of overflowing', () => {
    const nest = (n: number): string => '('.repeat(n) + '1' + ')'.repeat(n);
    expect(parse(nest(63))).toEqual(x.num(1));
    expect(failure(nest(64))).toMatchObject({ code: 'expr_parse', params: { expected: 'shallower' } });
    expect(failure('('.repeat(100_000))).toMatchObject({ code: 'expr_source_length' });
    expect(failure('('.repeat(1999))).toMatchObject({ code: 'expr_parse', params: { expected: 'shallower' } });
    expect(failure('-'.repeat(70) + 'points')).toMatchObject({ code: 'expr_parse', params: { expected: 'shallower' } });
    expect(failure('not '.repeat(70) + 'is_seed')).toMatchObject({ code: 'expr_parse', params: { expected: 'shallower' } });
    expect(failure('max(' .repeat(70) + '1')).toMatchObject({ code: 'expr_parse', params: { expected: 'shallower' } });
  });

  it('depth and node limits apply to the parsed tree', () => {
    expect(failure('-'.repeat(20) + 'points')).toEqual({ code: 'expr_depth', pointer: '', params: { limit: 12 } });
    expect(parse('-'.repeat(11) + 'points')).toMatchObject({ k: 'neg' });
    expect(failure(printExpr(x.nodes(201)))).toEqual({ code: 'expr_nodes', pointer: '', params: { limit: 200 } });
    expect(parseExpr(printExpr(x.nodes(200)), TEST_ENV)).toMatchObject({ ok: true });
    // Folding "-5" into a literal means a run of negative numbers costs one node each.
    const negatives = Array.from({ length: 100 }, () => '-5').join(' + ');
    expect(failure(negatives)).toMatchObject({ code: 'expr_depth' });
  });

  it('results contain only code, pointer and params', () => {
    for (const source of ['1 +', 'nope', '"x', '1 < 2 < 3', 'count(nope)']) {
      const result = parseExpr(source, TEST_ENV);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      for (const issue of result.issues) {
        expect(Object.keys(issue).sort()).toEqual(['code', 'params', 'pointer']);
        for (const value of Object.values(issue.params)) {
          expect(typeof value === 'number' || /^[a-z_,()[\]]*$/.test(String(value)) || /^[a-z_]+$/.test(String(value))).toBe(true);
        }
      }
    }
  });

  it('is total: a non-string input is an issue, not a throw', () => {
    expect(parseExpr(undefined as unknown as string, TEST_ENV)).toMatchObject({ ok: false });
  });
});

describe('parse then check', () => {
  it('a parsed expression type-checks against the same env', () => {
    const source = 'if(points >= 3 and tag in ["a", "b"], round(points / 2, 1), clamp(wins, 0, 5)) + sum(standings of item.points)';
    const expr = parse(source);
    expect(typeCheck(expr, TEST_ENV, 'number')).toMatchObject({ ok: true, type: 'number' });
  });

  it('type errors are left to typeCheck', () => {
    const expr = parse('1 + true');
    expect(typeCheck(expr, TEST_ENV)).toMatchObject({ ok: false });
  });
});
