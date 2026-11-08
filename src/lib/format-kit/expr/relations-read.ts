/**
 * The relations an expression reads through `rel(...)`, wherever in the tree. Used to keep a hidden relation out of what
 * a player can infer from the expression's result. Pure and client-safe.
 */
import type { Expr } from './ast';

function children(expr: Expr): readonly Expr[] {
  switch (expr.k) {
    case 'num':
    case 'bool':
    case 'str':
    case 'ref':
    case 'rand':
      return [];
    case 'neg':
    case 'not':
      return [expr.a];
    case 'arith':
    case 'cmp':
    case 'rel':
      return [expr.a, expr.b];
    case 'fn':
    case 'and':
    case 'or':
      return expr.args;
    case 'clamp':
      return [expr.x, expr.lo, expr.hi];
    case 'round':
      return [expr.x];
    case 'if':
      return [expr.cond, expr.then, expr.else];
    case 'in':
      return [expr.a];
    case 'agg':
      return [...(expr.of !== undefined ? [expr.of] : []), ...(expr.where !== undefined ? [expr.where] : [])];
  }
}

/** The keys of the relations `expr` reads, without repeats, in the order they first appear. */
export function relationsRead(expr: Expr): string[] {
  const found = new Set<string>();
  const visit = (node: Expr): void => {
    if (node.k === 'rel') found.add(node.relation);
    children(node).forEach(visit);
  };
  visit(expr);
  return [...found];
}
