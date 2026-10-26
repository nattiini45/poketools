/**
 * The expression AST. This is the stored form: a JSON tree with a `k` discriminator. Types here are
 * the single source of truth; `schema.ts` (zod) and `validate-json.ts` (no zod) describe the same
 * shape and are kept in step by a parity test.
 *
 * Counting rules: every node counts 1 and the root has depth 1; the literals in `in.set` and the
 * `round.digits` number are fields of their node and count 0.
 */

export type ExprType = 'number' | 'boolean' | 'text';
export type ExprValue = number | boolean | string;

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'str'; v: string }
  | { k: 'ref'; name: string; t: ExprType }
  | { k: 'neg'; a: Expr }
  | { k: 'arith'; op: '+' | '-' | '*' | '/'; a: Expr; b: Expr } // '/' is safe: x / 0 = 0
  | { k: 'fn'; fn: 'min' | 'max'; args: Expr[] } // 2..8 args
  | { k: 'clamp'; x: Expr; lo: Expr; hi: Expr }
  | { k: 'round'; x: Expr; digits: number } // int 0..6 (a field, not a node)
  | { k: 'cmp'; op: '<' | '<=' | '>' | '>=' | '==' | '!='; a: Expr; b: Expr }
  | { k: 'and'; args: Expr[] }
  | { k: 'or'; args: Expr[] } // 2..8
  | { k: 'not'; a: Expr }
  | { k: 'if'; cond: Expr; then: Expr; else: Expr }
  | { k: 'in'; a: Expr; set: (number | string)[] } // 1..32 homogeneous literals
  | { k: 'rel'; relation: string; a: Expr; b: Expr } // relation is a Key; operands are text
  | { k: 'rand'; key: string } // seeded_rand(key)
  | { k: 'agg'; fn: 'count' | 'sum' | 'min' | 'max' | 'any' | 'all'; over: string; of?: Expr; where?: Expr };

export type ExprKind = Expr['k'];

/** All values of `Expr['k']`, in declaration order. */
export const EXPR_KINDS: readonly ExprKind[] = [
  'num',
  'bool',
  'str',
  'ref',
  'neg',
  'arith',
  'fn',
  'clamp',
  'round',
  'cmp',
  'and',
  'or',
  'not',
  'if',
  'in',
  'rel',
  'rand',
  'agg',
];

export interface CollectionType {
  readonly fields: ReadonlyMap<string, ExprType>;
  readonly maxSize: number;
}

export interface TypeEnv {
  readonly refs: ReadonlyMap<string, ExprType>;
  readonly collections: ReadonlyMap<string, CollectionType>;
  readonly relations: ReadonlySet<string>;
}

export interface EvalContext {
  readonly refs: ReadonlyMap<string, ExprValue>;
  /** Collections are evaluated in the order given: sums depend on iteration order. */
  readonly collections: ReadonlyMap<string, readonly ReadonlyMap<string, ExprValue>[]>;
  readonly relations: ReadonlyMap<string, (a: string, b: string) => boolean>;
  readonly seed: string;
  readonly scope: string;
}

export type ExprIssueCode =
  | 'expr_parse'
  | 'expr_source_length'
  | 'expr_shape'
  | 'expr_depth'
  | 'expr_nodes'
  | 'expr_steps'
  | 'expr_type_mismatch'
  | 'expr_unknown_ref'
  | 'expr_ref_type'
  | 'expr_unknown_relation'
  | 'expr_unknown_collection'
  | 'expr_unknown_field'
  | 'expr_arity'
  | 'expr_number_range'
  | 'expr_string_length'
  | 'expr_result_type'
  | 'expr_item_scope'
  | 'expr_nested_aggregate';

/** Codes and params only, never English text: callers render them through the i18n catalog. */
export interface ExprIssue {
  code: ExprIssueCode;
  /** JSON pointer relative to the expression root; '' for the root itself. */
  pointer: string;
  params: Record<string, string | number | boolean>;
}

/** The expression-language type of a runtime value. */
export function valueType(v: ExprValue): ExprType {
  return typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text';
}

/**
 * Ordered child expressions of a node, in the order `withChildren` consumes them. Reads the fields
 * a well-formed node of that kind has; anything missing or malformed is skipped, so this is safe to
 * call on a hand-built tree (callers that need strictness validate separately).
 */
export function childrenOf(e: unknown): unknown[] {
  if (typeof e !== 'object' || e === null) return [];
  const n = e as Record<string, unknown>;
  switch (n.k) {
    case 'neg':
    case 'not':
      return [n.a];
    case 'arith':
    case 'cmp':
    case 'rel':
      return [n.a, n.b];
    case 'fn':
    case 'and':
    case 'or':
      // Not copied: a hostile `args` can be huge, and callers only read the result.
      return Array.isArray(n.args) ? (n.args as unknown[]) : [];
    case 'clamp':
      return [n.x, n.lo, n.hi];
    case 'round':
      return [n.x];
    case 'if':
      return [n.cond, n.then, n.else];
    case 'in':
      return [n.a];
    case 'agg': {
      const out: unknown[] = [];
      if (n.of !== undefined) out.push(n.of);
      if (n.where !== undefined) out.push(n.where);
      return out;
    }
    default:
      return [];
  }
}

/** Rebuild `e` with its children replaced, in `childrenOf` order. Only for well-formed nodes. */
export function withChildren(e: Expr, kids: Expr[]): Expr {
  switch (e.k) {
    case 'neg':
    case 'not':
      return { ...e, a: kids[0] };
    case 'arith':
    case 'cmp':
    case 'rel':
      return { ...e, a: kids[0], b: kids[1] };
    case 'fn':
    case 'and':
    case 'or':
      return { ...e, args: kids };
    case 'clamp':
      return { ...e, x: kids[0], lo: kids[1], hi: kids[2] };
    case 'round':
      return { ...e, x: kids[0] };
    case 'if':
      return { ...e, cond: kids[0], then: kids[1], else: kids[2] };
    case 'in':
      return { ...e, a: kids[0] };
    case 'agg': {
      const out = { ...e };
      let i = 0;
      if (e.of !== undefined) out.of = kids[i++];
      if (e.where !== undefined) out.where = kids[i];
      return out;
    }
    default:
      return e;
  }
}
