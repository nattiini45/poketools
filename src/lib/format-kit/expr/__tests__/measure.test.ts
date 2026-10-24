import { describe, expect, it } from 'vitest';
import { x } from '../../test-utils/gen-expr';
import { exceededLimit, measureExpr } from '../measure';
import { EXPR_MAX_DEPTH, EXPR_MAX_NODES } from '../limits';

describe('measureExpr', () => {
  it('counts nodes and depth (root has depth 1)', () => {
    expect(measureExpr(x.num(1))).toEqual({ nodes: 1, depth: 1, truncated: false });
    expect(measureExpr(x.arith('+', x.num(1), x.neg(x.ref('points'))))).toEqual({ nodes: 4, depth: 3, truncated: false });
  });

  it('counts set literals and round digits as zero', () => {
    expect(measureExpr(x.inSet(x.ref('points'), [1, 2, 3])).nodes).toBe(2);
    expect(measureExpr(x.round(x.ref('points'), 3)).nodes).toBe(2);
  });

  it('visits every child field: if, clamp, rel, aggregate of / where', () => {
    expect(measureExpr(x.ifx(x.bool(true), x.num(1), x.num(2))).nodes).toBe(4);
    expect(measureExpr(x.clamp(x.num(1), x.num(2), x.num(3))).nodes).toBe(4);
    expect(measureExpr(x.rel('same_group', x.str('a'), x.str('b'))).nodes).toBe(3);
    expect(measureExpr(x.agg('sum', 'standings', { of: x.item('points'), where: x.bool(true) })).nodes).toBe(3);
    expect(measureExpr(x.agg('count', 'standings')).nodes).toBe(1);
  });

  it('depth exactly 12 is not truncated and 13 is', () => {
    expect(measureExpr(x.chain(EXPR_MAX_DEPTH))).toEqual({ nodes: 12, depth: 12, truncated: false });
    const over = measureExpr(x.chain(EXPR_MAX_DEPTH + 1));
    expect(over.truncated).toBe(true);
    expect(over.depth).toBe(13);
    expect(exceededLimit(over)).toBe('expr_depth');
  });

  it('nodes exactly 200 is not truncated and 201 is', () => {
    expect(measureExpr(x.nodes(EXPR_MAX_NODES))).toMatchObject({ nodes: 200, truncated: false });
    const over = measureExpr(x.nodes(EXPR_MAX_NODES + 1));
    expect(over).toMatchObject({ nodes: 201, truncated: true });
    expect(exceededLimit(over)).toBe('expr_nodes');
  });

  it('honours custom limits', () => {
    expect(measureExpr(x.chain(40), { maxDepth: 32, maxNodes: 256 }).truncated).toBe(true);
    expect(measureExpr(x.chain(32), { maxDepth: 32, maxNodes: 256 }).truncated).toBe(false);
    expect(exceededLimit(measureExpr(x.nodes(257), { maxDepth: 32, maxNodes: 256 }), { maxDepth: 32 })).toBe('expr_nodes');
    expect(exceededLimit(measureExpr(x.num(1)))).toBeNull();
  });

  it('rejects a 100000-deep chain with a depth report, without overflowing the stack', () => {
    let deep = x.num(1);
    for (let i = 0; i < 100_000; i += 1) deep = x.neg(deep);
    const result = measureExpr(deep);
    expect(result.truncated).toBe(true);
    expect(exceededLimit(result)).toBe('expr_depth');
  });

  it('stops at the node limit for a huge flat or cyclic input', () => {
    const wide = { k: 'and', args: new Array(1_000_000).fill({ k: 'num', v: 1 }) };
    expect(measureExpr(wide)).toMatchObject({ nodes: 201, truncated: true });
    const cyclic: Record<string, unknown> = { k: 'neg' };
    cyclic.a = cyclic;
    expect(exceededLimit(measureExpr(cyclic))).toBe('expr_depth');
  });

  it('treats malformed input as leaves', () => {
    expect(measureExpr(undefined)).toMatchObject({ nodes: 1, truncated: false });
    expect(measureExpr('x')).toMatchObject({ nodes: 1 });
    expect(measureExpr({ k: 'zzz', a: { k: 'num', v: 1 } })).toMatchObject({ nodes: 1 });
    expect(measureExpr({ k: 'and', args: 5 })).toMatchObject({ nodes: 1 });
    expect(measureExpr({ k: 'neg', a: undefined })).toMatchObject({ nodes: 2 });
  });
});
