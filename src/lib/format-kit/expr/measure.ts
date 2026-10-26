import { childrenOf } from './ast';
import { EXPR_MAX_DEPTH, EXPR_MAX_NODES } from './limits';

export interface MeasureLimits {
  maxNodes: number;
  maxDepth: number;
}

export interface Measure {
  nodes: number;
  depth: number;
  /** True when counting stopped early because a limit was exceeded. */
  truncated: boolean;
}

/**
 * Count nodes and depth of an expression tree (root depth 1) without recursion. Counting stops as
 * soon as a limit is exceeded, so the cost is bounded by `maxNodes` however large or deep the input
 * is (a 100000-deep chain, a cyclic object, a million-element `args`). Works on unvalidated input:
 * anything that is not an object counts as a leaf node.
 */
export function measureExpr(e: unknown, limits: Partial<MeasureLimits> = {}): Measure {
  const maxNodes = limits.maxNodes ?? EXPR_MAX_NODES;
  const maxDepth = limits.maxDepth ?? EXPR_MAX_DEPTH;
  let nodes = 1;
  let depth = 1;
  if (maxNodes < 1 || maxDepth < 1) return { nodes, depth, truncated: true };
  const stack: { node: unknown; depth: number }[] = [{ node: e, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth: d } = stack.pop() as { node: unknown; depth: number };
    const kids = childrenOf(node);
    for (const kid of kids) {
      nodes += 1;
      const kidDepth = d + 1;
      if (kidDepth > depth) depth = kidDepth;
      if (nodes > maxNodes || kidDepth > maxDepth) return { nodes, depth, truncated: true };
      stack.push({ node: kid, depth: kidDepth });
    }
  }
  return { nodes, depth, truncated: false };
}

/** Which limit a truncated measure broke: depth is checked first. */
export function exceededLimit(m: Measure, limits: Partial<MeasureLimits> = {}): 'expr_depth' | 'expr_nodes' | null {
  if (!m.truncated) return null;
  const maxDepth = limits.maxDepth ?? EXPR_MAX_DEPTH;
  return m.depth > maxDepth ? 'expr_depth' : 'expr_nodes';
}
