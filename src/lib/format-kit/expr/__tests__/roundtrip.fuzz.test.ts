import { describe, expect, it } from 'vitest';
import type { Expr, ExprType } from '../ast';
import { genExpr, TEST_ENV } from '../../test-utils/gen-expr';
import { intBetween, mulberry32, pick } from '../../test-utils/prng';
import { EXPR_MAX_DEPTH, EXPR_MAX_NODES, EXPR_MAX_SOURCE_CHARS } from '../limits';
import { measureExpr } from '../measure';
import { normalizeExpr } from '../normalize';
import { parseExpr } from '../parser';
import { printExpr } from '../printer';
import { typeCheck } from '../typecheck';

const TYPES: ExprType[] = ['number', 'boolean', 'text'];
const ITERATIONS = 3000;

function kindsIn(e: Expr, into: Set<string>): void {
  const stack: Expr[] = [e];
  while (stack.length > 0) {
    const node = stack.pop() as Expr;
    into.add(node.k);
    switch (node.k) {
      case 'neg':
      case 'not':
      case 'in':
        stack.push(node.a);
        break;
      case 'round':
        stack.push(node.x);
        break;
      case 'arith':
      case 'cmp':
      case 'rel':
        stack.push(node.a, node.b);
        break;
      case 'fn':
      case 'and':
      case 'or':
        stack.push(...node.args);
        break;
      case 'clamp':
        stack.push(node.x, node.lo, node.hi);
        break;
      case 'if':
        stack.push(node.cond, node.then, node.else);
        break;
      case 'agg':
        if (node.of) stack.push(node.of);
        if (node.where) stack.push(node.where);
        break;
      default:
        break;
    }
  }
}

describe('print / parse round trip on generated ASTs', () => {
  it(`holds for ${ITERATIONS} well-typed canonical ASTs (fixed seed)`, () => {
    const rng = mulberry32(20_261_024);
    const seen = new Set<string>();
    let totalNodes = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const type = pick(rng, TYPES);
      const expr = genExpr(rng, TEST_ENV, type, intBetween(rng, 1, 150));
      kindsIn(expr, seen);

      const checked = typeCheck(expr, TEST_ENV, type);
      if (!checked.ok) throw new Error(`generator produced an ill-typed tree (#${i}): ${JSON.stringify(checked.issues)} for ${JSON.stringify(expr)}`);
      totalNodes += checked.nodes;

      const text = printExpr(expr);
      const parsed = parseExpr(text, TEST_ENV);
      if (!parsed.ok) throw new Error(`could not parse its own output (#${i}): ${text} -> ${JSON.stringify(parsed.issues)}`);
      expect(parsed.expr, text).toEqual(normalizeExpr(expr));
      // print is a fixed point through a parse
      expect(printExpr(parsed.expr), text).toBe(text);
    }
    // The fuzz must actually exercise every node kind and non-trivial trees.
    expect([...seen].sort()).toEqual(
      ['agg', 'and', 'arith', 'bool', 'clamp', 'cmp', 'fn', 'if', 'in', 'neg', 'not', 'num', 'or', 'rand', 'ref', 'rel', 'round', 'str'].sort(),
    );
    expect(totalNodes / ITERATIONS).toBeGreaterThan(8);
  });

  it('generated trees are already canonical', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 300; i += 1) {
      const expr = genExpr(rng, TEST_ENV, pick(rng, TYPES), intBetween(rng, 1, 100));
      expect(normalizeExpr(expr)).toEqual(expr);
    }
  });
});

describe('garbage input', () => {
  const FRAGMENTS = [
    '(', ')', '[', ']', ',', '+', '-', '*', '/', '<', '>', '<=', '>=', '==', '!=', '=', '!', '"', '\\', ' ', '\n', '.', '..', 'e', '1', '0', '12', '3.5', '1e9', '1e-7', '9999999999',
    'and', 'or', 'not', 'in', 'of', 'where', 'true', 'false', 'if', 'min', 'max', 'clamp', 'round', 'rel', 'seeded_rand', 'count', 'sum', 'any', 'all',
    'points', 'wins', 'tag', 'standings', 'players', 'item.points', 'item.', 'same_group', 'coin', 'constructor', 'toString', '__proto__', 'ünï', '\u{1f600}', '\u0000', '"abc"', '"unterminated',
  ];

  it(`${ITERATIONS} random strings always give a result within the limits`, () => {
    const rng = mulberry32(31_337);
    let accepted = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const length = intBetween(rng, 0, 60);
      let source = '';
      for (let j = 0; j < length; j += 1) source += pick(rng, FRAGMENTS) + (rng() < 0.5 ? ' ' : '');
      const result = parseExpr(source, TEST_ENV);
      if (result.ok) {
        accepted += 1;
        const measure = measureExpr(result.expr);
        expect(measure.truncated).toBe(false);
        expect(measure.depth).toBeLessThanOrEqual(EXPR_MAX_DEPTH);
        expect(measure.nodes).toBeLessThanOrEqual(EXPR_MAX_NODES);
        expect(parseExpr(printExpr(result.expr), TEST_ENV)).toEqual({ ok: true, expr: result.expr });
      } else {
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) expect(issue.code).toMatch(/^expr_/);
      }
    }
    // Some noise is valid by chance; most is not.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(ITERATIONS / 2);
  });

  it('long and deeply nested noise never throws', () => {
    const rng = mulberry32(5);
    const openers = ['(', 'not ', '-', 'max(', 'if(', 'count(standings where ', '[', '"'];
    for (let i = 0; i < 300; i += 1) {
      let source = '';
      while (source.length < intBetween(rng, 100, 3000)) source += pick(rng, openers) + (rng() < 0.3 ? 'points' : '');
      const result = parseExpr(source, TEST_ENV);
      if (result.ok) expect(measureExpr(result.expr).truncated).toBe(false);
      else if (source.length > EXPR_MAX_SOURCE_CHARS) expect(result.issues[0].code).toBe('expr_source_length');
    }
  });

  it('printing is also total for any parsed result', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 500; i += 1) {
      const source = Array.from({ length: intBetween(rng, 1, 12) }, () => pick(rng, FRAGMENTS)).join(' ');
      const result = parseExpr(source, TEST_ENV);
      if (result.ok) expect(typeof printExpr(result.expr)).toBe('string');
    }
  });
});
