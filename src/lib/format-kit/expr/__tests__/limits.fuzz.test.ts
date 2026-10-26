import { describe, expect, it } from 'vitest';
import type { EvalContext, Expr, ExprValue, TypeEnv } from '../ast';
import { x } from '../../test-utils/gen-expr';
import { intBetween, mulberry32, type Rng } from '../../test-utils/prng';
import { evaluate } from '../eval';
import { EXPR_MAX_DEPTH, EXPR_MAX_NODES, EXPR_STEP_BUDGET } from '../limits';
import { measureExpr } from '../measure';
import { typeCheck } from '../typecheck';

/** A body of exactly `nodes` nodes over `item.v`, with no short-circuit (so its cost is exact). */
function body(nodes: number): Expr {
  let e: Expr = x.item('v');
  let used = 1;
  while (used + 2 <= nodes) {
    e = x.arith('+', e, x.item('v'));
    used += 2;
  }
  return used < nodes ? x.neg(e) : e;
}

interface Case {
  expr: Expr;
  env: TypeEnv;
  ctx: EvalContext;
}

function buildCase(rng: Rng): Case {
  const size = intBetween(rng, 1, 300);
  const aggCount = intBetween(rng, 1, 4);
  const aggs: Expr[] = Array.from({ length: aggCount }, () => x.agg('sum', 'big', { of: body(intBetween(rng, 1, 12)) }));
  const core: Expr = aggCount === 1 ? aggs[0] : x.fn('max', ...aggs);

  // Pad towards a node target around the limit and a depth target around the limit.
  const nodeTarget = intBetween(rng, 190, 210);
  const depthTarget = intBetween(rng, 10, 14);
  let expr = core;
  let measure = measureExpr(expr, { maxNodes: 10_000, maxDepth: 10_000 });
  // Depth first: wrap in negations (each +1 node, +1 depth) up to the target.
  while (measure.depth < depthTarget) {
    expr = x.neg(expr);
    measure = measureExpr(expr, { maxNodes: 10_000, maxDepth: 10_000 });
  }
  // Then fill with sibling leaves (+1 node each, depth unchanged below the root fn).
  const missing = nodeTarget - measure.nodes - 1;
  if (missing >= 1) {
    const fillers: Expr[] = [];
    let remaining = missing;
    while (remaining > 0 && fillers.length < 7) {
      const take = fillers.length === 6 ? remaining : intBetween(rng, 1, Math.min(remaining, 40));
      fillers.push(x.nodes(take));
      remaining -= take;
    }
    expr = x.fn('max', expr, ...fillers);
  }
  const env: TypeEnv = {
    refs: new Map(),
    collections: new Map([['big', { fields: new Map([['v', 'number' as const]]), maxSize: size }]]),
    relations: new Set(),
  };
  const rows = Array.from({ length: size }, () => new Map<string, ExprValue>([['v', 1]]));
  const ctx: EvalContext = { refs: new Map(), collections: new Map([['big', rows]]), relations: new Map(), seed: 's', scope: 'sc' };
  return { expr, env, ctx };
}

describe('typeCheck and evaluate agree around the limits', () => {
  it('whatever typeCheck accepts never exceeds the budget; rejections are consistent (fixed seed)', () => {
    const rng = mulberry32(424_242);
    const tally = { ok: 0, depth: 0, nodes: 0, steps: 0, slack: 0 };
    for (let i = 0; i < 2500; i += 1) {
      const { expr, env, ctx } = buildCase(rng);
      const checked = typeCheck(expr, env, 'number');
      const result = evaluate(expr, ctx, 'number');
      const label = `case ${i}`;

      if (checked.ok) {
        tally.ok += 1;
        // Accepted statically: it runs within budget, and the static bound is an upper bound.
        expect(result.ok, label).toBe(true);
        expect(checked.maxSteps, label).toBeLessThanOrEqual(EXPR_STEP_BUDGET);
        expect(result.steps, label).toBeLessThanOrEqual(checked.maxSteps);
        expect(checked.depth, label).toBeLessThanOrEqual(EXPR_MAX_DEPTH);
        expect(checked.nodes, label).toBeLessThanOrEqual(EXPR_MAX_NODES);
        continue;
      }

      const codes = checked.issues.map((issue) => issue.code);
      // Structural rejections: evaluate refuses the same trees, with the same code, before running.
      if (codes.includes('expr_depth') || codes.includes('expr_nodes')) {
        const code = codes.includes('expr_depth') ? 'expr_depth' : 'expr_nodes';
        tally[code === 'expr_depth' ? 'depth' : 'nodes'] += 1;
        expect(result.ok, label).toBe(false);
        expect(!result.ok && result.issue.code, label).toBe(code);
        expect(result.steps, label).toBe(0);
        continue;
      }

      // Otherwise the only static complaint is the step bound.
      expect(codes, label).toEqual(['expr_steps']);
      tally.steps += 1;
      if (result.ok) {
        // The bound carries 1 step of slack: the run may land exactly on the budget.
        tally.slack += 1;
        expect(result.steps, label).toBe(EXPR_STEP_BUDGET);
      } else {
        expect(result.issue.code, label).toBe('expr_steps');
        expect(result.steps, label).toBe(EXPR_STEP_BUDGET + 1);
      }
    }
    // The generator really straddles every limit.
    expect(tally.ok).toBeGreaterThan(100);
    expect(tally.depth).toBeGreaterThan(50);
    expect(tally.nodes).toBeGreaterThan(50);
    expect(tally.steps).toBeGreaterThan(40);
  });

  it('whatever evaluate rejects for steps was flagged by the static bound', () => {
    const rng = mulberry32(77);
    for (let i = 0; i < 600; i += 1) {
      const { expr, env, ctx } = buildCase(rng);
      const result = evaluate(expr, ctx);
      if (!result.ok && result.issue.code === 'expr_steps') {
        const checked = typeCheck(expr, env);
        expect(checked.ok).toBe(false);
        expect(!checked.ok && checked.issues.map((issue) => issue.code)).toContain('expr_steps');
      }
    }
  });

  it('a collection larger than the static estimate is still stopped at run time', () => {
    // typeCheck trusted maxSize = 4; the context supplies 4000 rows: the runtime budget still holds.
    const env: TypeEnv = {
      refs: new Map(),
      collections: new Map([['big', { fields: new Map([['v', 'number' as const]]), maxSize: 4 }]]),
      relations: new Set(),
    };
    const expr = x.agg('sum', 'big', { of: body(5) });
    expect(typeCheck(expr, env)).toMatchObject({ ok: true });
    const rows = Array.from({ length: 4000 }, () => new Map<string, ExprValue>([['v', 1]]));
    const result = evaluate(expr, { refs: new Map(), collections: new Map([['big', rows]]), relations: new Map(), seed: 's', scope: 'sc' });
    expect(result).toMatchObject({ ok: false, issue: { code: 'expr_steps' }, steps: EXPR_STEP_BUDGET + 1 });
  });
});
