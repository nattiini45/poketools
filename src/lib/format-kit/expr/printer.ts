import type { Expr } from './ast';

/**
 * Operator precedence, lowest to highest. The parser binds with the same table, so a node is
 * parenthesised exactly when its precedence is lower than the context requires.
 */
export const PRECEDENCE = {
  or: 1,
  and: 2,
  not: 3,
  cmp: 4, // comparisons and `in`; non-associative
  sum: 5, // + -
  term: 6, // * /
  unary: 7, // prefix -
  primary: 8,
} as const;

/** Canonical number text: shortest round-trip form, no '+' in exponents, never "-0". */
export function formatNumber(n: number): string {
  if (n === 0) return '0';
  return String(n).replace('e+', 'e');
}

/** String literal text: only `\"` and `\\` are escaped. */
export function formatString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function precedenceOf(e: Expr): number {
  switch (e.k) {
    case 'or':
      return PRECEDENCE.or;
    case 'and':
      return PRECEDENCE.and;
    case 'not':
      return PRECEDENCE.not;
    case 'cmp':
    case 'in':
      return PRECEDENCE.cmp;
    case 'arith':
      return e.op === '+' || e.op === '-' ? PRECEDENCE.sum : PRECEDENCE.term;
    case 'neg':
      return PRECEDENCE.unary;
    case 'num':
      return e.v < 0 ? PRECEDENCE.unary : PRECEDENCE.primary;
    default:
      return PRECEDENCE.primary;
  }
}

type Task = string | { e: Expr; min: number };

/**
 * Readable text form with the fewest parentheses that keep the tree's structure. The inverse of
 * `parseExpr` for canonical trees (see `normalizeExpr`). Iterative: the output is assembled from an
 * explicit stack of literal text and sub-expressions, so depth cannot overflow the stack.
 */
export function printExpr(root: Expr): string {
  let out = '';
  const stack: Task[] = [{ e: root, min: 0 }];

  /** Push `parts` so they come out in order. */
  const emit = (parts: Task[]): void => {
    for (let i = parts.length - 1; i >= 0; i -= 1) stack.push(parts[i]);
  };

  while (stack.length > 0) {
    const task = stack.pop() as Task;
    if (typeof task === 'string') {
      out += task;
      continue;
    }
    const { e, min } = task;
    const wrap = precedenceOf(e) < min;
    const parts: Task[] = [];
    if (wrap) parts.push('(');
    switch (e.k) {
      case 'num':
        parts.push(formatNumber(e.v));
        break;
      case 'bool':
        parts.push(e.v ? 'true' : 'false');
        break;
      case 'str':
        parts.push(formatString(e.v));
        break;
      case 'ref':
        parts.push(e.name);
        break;
      case 'neg':
        // A nested negation or a negative literal gets parentheses: -(-x), not --x.
        parts.push('-', { e: e.a, min: PRECEDENCE.primary });
        break;
      case 'arith': {
        const sum = e.op === '+' || e.op === '-';
        // Left-associative: the right operand needs one level more, so a - (b - c) keeps its parentheses.
        parts.push(
          { e: e.a, min: sum ? PRECEDENCE.sum : PRECEDENCE.term },
          ` ${e.op} `,
          { e: e.b, min: sum ? PRECEDENCE.term : PRECEDENCE.unary },
        );
        break;
      }
      case 'fn':
        parts.push(e.fn, '(');
        e.args.forEach((arg, i) => parts.push(...(i > 0 ? [', '] : []), { e: arg, min: 0 }));
        parts.push(')');
        break;
      case 'clamp':
        parts.push('clamp(', { e: e.x, min: 0 }, ', ', { e: e.lo, min: 0 }, ', ', { e: e.hi, min: 0 }, ')');
        break;
      case 'round':
        parts.push('round(', { e: e.x, min: 0 });
        if (e.digits !== 0) parts.push(`, ${e.digits}`);
        parts.push(')');
        break;
      case 'cmp':
        // Non-associative: a nested comparison always gets parentheses.
        parts.push({ e: e.a, min: PRECEDENCE.sum }, ` ${e.op} `, { e: e.b, min: PRECEDENCE.sum });
        break;
      case 'and':
      case 'or': {
        const sep = e.k === 'and' ? ' and ' : ' or ';
        // Operands of the same operator keep their parentheses, so the tree shape survives a reparse.
        const argMin = precedenceOf(e) + 1;
        e.args.forEach((arg, i) => parts.push(...(i > 0 ? [sep] : []), { e: arg, min: argMin }));
        break;
      }
      case 'not':
        parts.push('not ', { e: e.a, min: PRECEDENCE.not });
        break;
      case 'if':
        parts.push('if(', { e: e.cond, min: 0 }, ', ', { e: e.then, min: 0 }, ', ', { e: e.else, min: 0 }, ')');
        break;
      case 'in':
        parts.push({ e: e.a, min: PRECEDENCE.sum }, ' in [', e.set.map((v) => (typeof v === 'number' ? formatNumber(v) : formatString(v))).join(', '), ']');
        break;
      case 'rel':
        parts.push('rel(', e.relation, ', ', { e: e.a, min: 0 }, ', ', { e: e.b, min: 0 }, ')');
        break;
      case 'rand':
        parts.push('seeded_rand(', e.key, ')');
        break;
      case 'agg':
        parts.push(e.fn, '(', e.over);
        if (e.of !== undefined) parts.push(' of ', { e: e.of, min: 0 });
        if (e.where !== undefined) parts.push(' where ', { e: e.where, min: 0 });
        parts.push(')');
        break;
    }
    if (wrap) parts.push(')');
    emit(parts);
  }
  return out;
}
