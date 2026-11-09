/**
 * The relations an expression depends on, wherever in the tree. Used to keep a hidden relation out of what a player can
 * infer from the expression's result. Pure and client-safe.
 */
import type { AttributeDef, RuleEntry } from '../types';
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

/**
 * The keys of the relations `expr` reads, without repeats, in the order they first appear. A player attribute computed by
 * an expression (`assign: { kind: 'expr' }`) counts with what that expression reads: its value depends on the relation just the same.
 * A stored player attribute counts with what every `set_attr` of `rules` that writes it reads in its rule's `when` and its
 * target's `where`: which players hold the value can depend on the relation through the players that effect picked.
 */
export function relationsRead(expr: Expr, attributes: readonly AttributeDef[] = [], rules: readonly RuleEntry[] = []): string[] {
  const found = new Set<string>();
  const followed = new Set<string>();
  const visit = (node: Expr): void => {
    if (node.k === 'rel') found.add(node.relation);
    if (node.k === 'ref' && node.name.startsWith('attr.')) {
      const attr = attributes.find((a) => a.on === 'player' && `attr.${a.key}` === node.name);
      if (attr !== undefined && !followed.has(attr.key)) {
        followed.add(attr.key);
        if (attr.assign?.kind === 'expr') visit(attr.assign.expr);
        for (const rule of rules) {
          if (rule.kind !== 'rule.on_event') continue;
          for (const effect of rule.effects) {
            if (effect.effect !== 'set_attr' || effect.attr !== attr.key) continue;
            if (rule.when !== undefined) visit(rule.when);
            if (effect.to.where !== undefined) visit(effect.to.where);
          }
        }
      }
    }
    children(node).forEach(visit);
  };
  visit(expr);
  return [...found];
}
