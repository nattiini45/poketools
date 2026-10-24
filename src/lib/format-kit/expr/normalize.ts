import { childrenOf, withChildren, type Expr } from './ast';
import { EXPR_MAX_ARGS } from './limits';

/**
 * Rewrite one node whose children are already normalized.
 *  - neg(num v) folds to num(-v); never produces -0.
 *  - and/or nested in the same operator are flattened, as long as the result still has at most
 *    EXPR_MAX_ARGS operands (otherwise the nesting is kept and the printer keeps its parentheses).
 */
function normalizeNode(e: Expr): Expr {
  if (e.k === 'neg' && e.a.k === 'num') return { k: 'num', v: e.a.v === 0 ? 0 : -e.a.v };
  if (e.k === 'and' || e.k === 'or') {
    const flat: Expr[] = [];
    for (const arg of e.args) {
      if (arg.k === e.k) flat.push(...arg.args);
      else flat.push(arg);
    }
    if (flat.length > e.args.length && flat.length <= EXPR_MAX_ARGS) return { k: e.k, args: flat };
    // Flattening only some operands would be arbitrary: keep the tree as is.
  }
  return e;
}

/**
 * Canonical form of an AST: `neg(num)` folded and nested `and`/`or` flattened. Everything else is
 * untouched. Idempotent. Iterative (post-order with an explicit stack), so a very deep tree cannot
 * overflow the stack.
 */
export function normalizeExpr(root: Expr): Expr {
  interface Frame {
    node: Expr;
    kids: Expr[];
    index: number;
    out: Expr[];
  }
  const stack: Frame[] = [{ node: root, kids: childrenOf(root) as Expr[], index: 0, out: [] }];
  let result: Expr = root;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index < frame.kids.length) {
      const child = frame.kids[frame.index];
      frame.index += 1;
      stack.push({ node: child, kids: childrenOf(child) as Expr[], index: 0, out: [] });
      continue;
    }
    stack.pop();
    const rebuilt = normalizeNode(frame.kids.length === 0 ? frame.node : withChildren(frame.node, frame.out));
    if (stack.length > 0) stack[stack.length - 1].out.push(rebuilt);
    else result = rebuilt;
  }
  return result;
}
