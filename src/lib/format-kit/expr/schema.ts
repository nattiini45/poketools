import { z } from 'zod';
import { KEY_PATTERN, REF_NAME_PATTERN } from '@/lib/studio-core/keys';
import { EXPR_KINDS, type Expr, type ExprType } from './ast';
import { EXPR_MAX_ARGS, EXPR_MAX_ROUND_DIGITS, EXPR_MAX_SET, EXPR_SCHEMA_MAX_DEPTH, EXPR_SCHEMA_MAX_NODES } from './limits';
import { exceededLimit, measureExpr } from './measure';
import { staticRootType } from './validate-json';

/**
 * Server-side zod schema of the expression AST. Server only: the browser uses `validateExprJson`
 * (validate-json.ts), its zero-zod twin, and a parity test keeps the two in step.
 *
 * zod recurses over the input, so it must never see an unbounded tree. Every expression slot is
 * therefore guarded at its ROOT by an iterative pre-check (`measureExpr`: at most
 * EXPR_SCHEMA_MAX_NODES nodes and EXPR_SCHEMA_MAX_DEPTH levels) that reports a custom issue
 * `{ code: 'limit', limit: 'expr_nodes' | 'expr_depth' }` and stops (pipe). The document schema must
 * also run `inspectJson` before zod sees the document; that bounds everything else.
 *
 * Only shape is checked here. Literal ranges (|x| <= 1e9, strings <= 64 chars) and all typing are
 * `typeCheck`'s job so they surface as `expr_*` diagnostics.
 *
 * Issue codes follow the contract's zod mapping: a bad or missing `k` is reported as invalid_value /
 * invalid_type by a per-node guard (never as zod's invalid_union), and the checks zod cannot express
 * (limits, set element type, root type) are custom issues whose `params.code` is the schema code.
 */

const KIND_VALUES: readonly string[] = EXPR_KINDS;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const key = z.string().regex(KEY_PATTERN);
const refName = z.string().regex(REF_NAME_PATTERN);
const exprType = z.enum(['number', 'boolean', 'text']);

/** Per-node guard: object with an own, known `k`. Keeps zod's discriminatedUnion from raising invalid_union. */
const nodeGuard = z.unknown().superRefine((value, ctx) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    ctx.addIssue({ code: 'invalid_type', expected: 'object', input: value, path: [] });
    return;
  }
  if (!hasOwn(value, 'k')) {
    ctx.addIssue({ code: 'invalid_type', expected: 'string', input: undefined, path: ['k'] });
    return;
  }
  const k = (value as { k: unknown }).k;
  if (typeof k !== 'string' || !KIND_VALUES.includes(k)) {
    ctx.addIssue({ code: 'invalid_value', values: [...KIND_VALUES], input: k, path: ['k'] });
  }
});

/** A set element is a number or a string; anything else is a `type` issue. */
const setItem = z.custom<number | string>((v) => typeof v === 'number' || typeof v === 'string', {
  error: 'set item must be a number or a string',
  params: { code: 'type', expected: 'literal' },
});

const node: z.ZodType<Expr> = z.lazy(() => nodeGuard.pipe(union) as unknown as z.ZodType<Expr>);

const binary = (op: z.ZodType) => ({ op, a: node, b: node });

const union = z.discriminatedUnion('k', [
  z.strictObject({ k: z.literal('num'), v: z.number() }),
  z.strictObject({ k: z.literal('bool'), v: z.boolean() }),
  z.strictObject({ k: z.literal('str'), v: z.string() }),
  z.strictObject({ k: z.literal('ref'), name: refName, t: exprType }),
  z.strictObject({ k: z.literal('neg'), a: node }),
  z.strictObject({ k: z.literal('arith'), ...binary(z.enum(['+', '-', '*', '/'])) }),
  z.strictObject({ k: z.literal('fn'), fn: z.enum(['min', 'max']), args: z.array(node).min(2).max(EXPR_MAX_ARGS) }),
  z.strictObject({ k: z.literal('clamp'), x: node, lo: node, hi: node }),
  z.strictObject({ k: z.literal('round'), x: node, digits: z.number().int().min(0).max(EXPR_MAX_ROUND_DIGITS) }),
  z.strictObject({ k: z.literal('cmp'), ...binary(z.enum(['<', '<=', '>', '>=', '==', '!='])) }),
  z.strictObject({ k: z.literal('and'), args: z.array(node).min(2).max(EXPR_MAX_ARGS) }),
  z.strictObject({ k: z.literal('or'), args: z.array(node).min(2).max(EXPR_MAX_ARGS) }),
  z.strictObject({ k: z.literal('not'), a: node }),
  z.strictObject({ k: z.literal('if'), cond: node, then: node, else: node }),
  z.strictObject({ k: z.literal('in'), a: node, set: z.array(setItem).min(1).max(EXPR_MAX_SET) }),
  z.strictObject({ k: z.literal('rel'), relation: key, a: node, b: node }),
  z.strictObject({ k: z.literal('rand'), key }),
  z.strictObject({
    k: z.literal('agg'),
    fn: z.enum(['count', 'sum', 'min', 'max', 'any', 'all']),
    over: key,
    of: node.optional(),
    where: node.optional(),
  }),
]);

/**
 * Root guard, decided before zod looks at the structure (a failing guard stops the pipe):
 *  1. the tree is bounded (limit issue), then
 *  2. the root's static type matches `expected` where determinable (custom `type` issue).
 */
function rootGuard(expected: ExprType | 'any'): z.ZodType<unknown> {
  return z.unknown().superRefine((value, ctx) => {
    const limits = { maxNodes: EXPR_SCHEMA_MAX_NODES, maxDepth: EXPR_SCHEMA_MAX_DEPTH };
    const exceeded = exceededLimit(measureExpr(value, limits), limits);
    if (exceeded !== null) {
      ctx.addIssue({ code: 'custom', message: exceeded, params: { code: 'limit', limit: exceeded } });
      return;
    }
    if (expected === 'any') return;
    const actual = staticRootType(value);
    if (actual !== null && actual !== expected) {
      ctx.addIssue({ code: 'custom', message: 'expression has the wrong type', params: { code: 'type', expected, actual } });
    }
  });
}

const rootSchemas = new Map<ExprType | 'any', z.ZodType<Expr>>();

/**
 * `exprSchemaFor(type)` is `exprSchema` that also asserts the root's static type where it is
 * determinable (boolean for cmp/and/or/not/in/rel/any/all/bool, number for
 * arith/neg/min/max/clamp/round/rand/num/count/sum, `t` for ref, text for str). An `if` root is left
 * to `typeCheck`. A mismatch is a custom `type` issue at the root; like the limit issue it is decided
 * before the structure is validated.
 */
export function exprSchemaFor(type: ExprType | 'any'): z.ZodType<Expr> {
  let schema = rootSchemas.get(type);
  if (schema === undefined) {
    schema = rootGuard(type).pipe(node) as unknown as z.ZodType<Expr>;
    rootSchemas.set(type, schema);
  }
  return schema;
}

/** An expression of any type; see the module comment for what is and is not checked. */
export const exprSchema: z.ZodType<Expr> = exprSchemaFor('any');
