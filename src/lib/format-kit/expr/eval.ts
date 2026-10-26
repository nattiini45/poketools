import { KEY_PATTERN } from '../keys';
import { valueType, type EvalContext, type Expr, type ExprIssue, type ExprIssueCode, type ExprType, type ExprValue } from './ast';
import { exceededLimit, measureExpr } from './measure';
import {
  EXPR_MAX_ARGS,
  EXPR_MAX_DEPTH,
  EXPR_MAX_NODES,
  EXPR_MAX_ROUND_DIGITS,
  EXPR_MAX_SET,
  EXPR_MAX_STRING,
  EXPR_NUM_LIMIT,
  EXPR_STEP_BUDGET,
} from './limits';
import { seededRand } from './rand';

export type EvalResult = { ok: true; value: ExprValue; steps: number } | { ok: false; issue: ExprIssue; steps: number };

type Params = Record<string, string | number | boolean>;

/** Thrown inside the evaluator to unwind to `evaluate`, which turns it into a result. */
class EvalFailure {
  constructor(readonly issue: ExprIssue) {}
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Round half away from zero to `digits` decimals. Not Math.round (which rounds halves toward +inf)
 * and not `x * 10^d` (1.005 * 100 is 100.49999999999999): the decimal digits of the shortest
 * round-trip text are shifted by changing the exponent, so 1.005 is exactly 100.5 at d = 2.
 */
export function roundHalfAwayFromZero(x: number, digits: number): number {
  if (x === 0) return 0;
  const [mantissa, exponent] = Math.abs(x).toString().split('e');
  const shifted = Number(`${mantissa}e${Number(exponent ?? 0) + digits}`);
  const floor = Math.floor(shifted);
  const rounded = shifted - floor >= 0.5 ? floor + 1 : floor;
  const result = rounded / 10 ** digits;
  if (result === 0) return 0;
  return x < 0 ? -result : result;
}

/**
 * Evaluate `e` against `ctx`. Never throws: every failure is an `ExprIssue` in the result.
 *
 * It does not trust that `typeCheck` ran: it measures first (depth, nodes), re-checks ref types
 * against the context values and enforces the number range and the step budget while running.
 *
 * Semantics (part of the stored-definition contract; changing them breaks stored documents):
 *  - One step is charged per node visited, plus 1 per aggregate iteration; more than
 *    EXPR_STEP_BUDGET steps fails with `expr_steps`.
 *  - Every literal, ref value and arithmetic result must be finite with |x| <= EXPR_NUM_LIMIT, else
 *    `expr_number_range`. -0 is normalised to 0.
 *  - `a / b` is 0 when b is 0.
 *  - round(x, d) rounds half away from zero to d decimals (0..6).
 *  - clamp(x, lo, hi) is max(lo, min(x, hi)): when lo > hi, lo wins.
 *  - min/max/sum/count over an empty aggregate are 0; any(empty) is false; all(empty) is true.
 *    any/all stop at the first deciding row; the others visit every selected row in collection order.
 *  - == and != compare text by UTF-16 code units; text has no ordering.
 *  - and/or short-circuit and only charge the nodes actually evaluated; `if` evaluates one branch.
 *  - rand: seededRand(ctx.seed, ctx.scope, key). rel: ctx.relations.get(name)?.(a, b), false when
 *    the relation is absent from the context.
 *  - The value's type is checked against `expected` when given (`expr_result_type`).
 * No clock, no unseeded randomness, no I/O, no regular expressions on input, no eval or dynamic code.
 */
export function evaluate(e: Expr, ctx: EvalContext, expected?: ExprType): EvalResult {
  let steps = 0;
  try {
    const measure = measureExpr(e);
    const exceeded = exceededLimit(measure);
    if (exceeded !== null) {
      const limit = exceeded === 'expr_depth' ? EXPR_MAX_DEPTH : EXPR_MAX_NODES;
      return { ok: false, issue: { code: exceeded, pointer: '', params: { limit } }, steps };
    }

    const fail = (code: ExprIssueCode, pointer: string, params: Params = {}): never => {
      throw new EvalFailure({ code, pointer, params });
    };
    const charge = (): void => {
      steps += 1;
      if (steps > EXPR_STEP_BUDGET) fail('expr_steps', '', { budget: EXPR_STEP_BUDGET });
    };
    const inRange = (n: number, pointer: string): number => {
      if (!Number.isFinite(n) || Math.abs(n) > EXPR_NUM_LIMIT) fail('expr_number_range', pointer, { limit: EXPR_NUM_LIMIT });
      return n === 0 ? 0 : n;
    };

    /** Evaluate a child and require a value of type `want`. */
    const run = (node: unknown, ptr: string, row: ReadonlyMap<string, ExprValue> | null, inAgg: boolean, want?: ExprType): ExprValue => {
      charge();
      if (!isObject(node) || typeof node.k !== 'string') return fail('expr_shape', ptr);
      const value = step(node, ptr, row, inAgg);
      if (want !== undefined) {
        const got = valueType(value);
        if (got !== want) fail('expr_type_mismatch', ptr, { expected: want, actual: got });
      }
      return value;
    };
    const num = (node: unknown, ptr: string, row: ReadonlyMap<string, ExprValue> | null, inAgg: boolean): number =>
      run(node, ptr, row, inAgg, 'number') as number;
    const bool = (node: unknown, ptr: string, row: ReadonlyMap<string, ExprValue> | null, inAgg: boolean): boolean =>
      run(node, ptr, row, inAgg, 'boolean') as boolean;
    const argList = (node: Record<string, unknown>, ptr: string, field: string): unknown[] => {
      const list = node[field];
      if (!Array.isArray(list)) return fail('expr_shape', `${ptr}/${field}`);
      if (list.length < 2 || list.length > EXPR_MAX_ARGS) fail('expr_arity', `${ptr}/${field}`, { min: 2, max: EXPR_MAX_ARGS, actual: list.length });
      return list;
    };

    const step = (node: Record<string, unknown>, ptr: string, row: ReadonlyMap<string, ExprValue> | null, inAgg: boolean): ExprValue => {
      switch (node.k) {
        case 'num': {
          if (typeof node.v !== 'number') return fail('expr_shape', `${ptr}/v`);
          return inRange(node.v, `${ptr}/v`);
        }
        case 'bool':
          if (typeof node.v !== 'boolean') return fail('expr_shape', `${ptr}/v`);
          return node.v;
        case 'str':
          if (typeof node.v !== 'string') return fail('expr_shape', `${ptr}/v`);
          if (node.v.length > EXPR_MAX_STRING) fail('expr_string_length', `${ptr}/v`, { length: node.v.length, limit: EXPR_MAX_STRING });
          return node.v;
        case 'ref':
          return readRef(node, ptr, row, inAgg);
        case 'neg':
          return inRange(-num(node.a, `${ptr}/a`, row, inAgg), ptr);
        case 'arith': {
          const a = num(node.a, `${ptr}/a`, row, inAgg);
          const b = num(node.b, `${ptr}/b`, row, inAgg);
          switch (node.op) {
            case '+':
              return inRange(a + b, ptr);
            case '-':
              return inRange(a - b, ptr);
            case '*':
              return inRange(a * b, ptr);
            case '/':
              return b === 0 ? 0 : inRange(a / b, ptr);
            default:
              return fail('expr_shape', `${ptr}/op`);
          }
        }
        case 'fn': {
          if (node.fn !== 'min' && node.fn !== 'max') return fail('expr_shape', `${ptr}/fn`);
          const values = argList(node, ptr, 'args').map((arg, i) => num(arg, `${ptr}/args/${i}`, row, inAgg));
          return node.fn === 'min' ? Math.min(...values) : Math.max(...values);
        }
        case 'clamp': {
          const x = num(node.x, `${ptr}/x`, row, inAgg);
          const lo = num(node.lo, `${ptr}/lo`, row, inAgg);
          const hi = num(node.hi, `${ptr}/hi`, row, inAgg);
          return inRange(Math.max(lo, Math.min(x, hi)), ptr);
        }
        case 'round': {
          const x = num(node.x, `${ptr}/x`, row, inAgg);
          const d = node.digits;
          if (typeof d !== 'number' || !Number.isInteger(d)) return fail('expr_shape', `${ptr}/digits`);
          if (d < 0 || d > EXPR_MAX_ROUND_DIGITS) fail('expr_number_range', `${ptr}/digits`, { min: 0, max: EXPR_MAX_ROUND_DIGITS });
          return inRange(roundHalfAwayFromZero(x, d), ptr);
        }
        case 'cmp': {
          if (node.op === '==' || node.op === '!=') {
            const a = run(node.a, `${ptr}/a`, row, inAgg);
            const b = run(node.b, `${ptr}/b`, row, inAgg);
            if (valueType(a) !== valueType(b)) fail('expr_type_mismatch', `${ptr}/b`, { expected: valueType(a), actual: valueType(b) });
            return node.op === '==' ? a === b : a !== b;
          }
          const a = num(node.a, `${ptr}/a`, row, inAgg);
          const b = num(node.b, `${ptr}/b`, row, inAgg);
          switch (node.op) {
            case '<':
              return a < b;
            case '<=':
              return a <= b;
            case '>':
              return a > b;
            case '>=':
              return a >= b;
            default:
              return fail('expr_shape', `${ptr}/op`);
          }
        }
        case 'and':
        case 'or': {
          const args = argList(node, ptr, 'args');
          const stopOn = node.k === 'or';
          for (let i = 0; i < args.length; i += 1) {
            if (bool(args[i], `${ptr}/args/${i}`, row, inAgg) === stopOn) return stopOn;
          }
          return !stopOn;
        }
        case 'not':
          return !bool(node.a, `${ptr}/a`, row, inAgg);
        case 'if':
          return bool(node.cond, `${ptr}/cond`, row, inAgg)
            ? run(node.then, `${ptr}/then`, row, inAgg)
            : run(node.else, `${ptr}/else`, row, inAgg);
        case 'in': {
          const operand = run(node.a, `${ptr}/a`, row, inAgg);
          const set = node.set;
          if (!Array.isArray(set)) return fail('expr_shape', `${ptr}/set`);
          if (set.length < 1 || set.length > EXPR_MAX_SET) fail('expr_arity', `${ptr}/set`, { min: 1, max: EXPR_MAX_SET, actual: set.length });
          if (typeof operand === 'boolean') return fail('expr_type_mismatch', `${ptr}/a`, { expected: 'number', actual: 'boolean' });
          let found = false;
          set.forEach((item: unknown, i) => {
            if (typeof item !== typeof operand) fail('expr_type_mismatch', `${ptr}/set/${i}`, { expected: valueType(operand), actual: typeof item });
            if (item === operand) found = true;
          });
          return found;
        }
        case 'rel': {
          const name = node.relation;
          if (typeof name !== 'string') return fail('expr_shape', `${ptr}/relation`);
          const a = run(node.a, `${ptr}/a`, row, inAgg, 'text') as string;
          const b = run(node.b, `${ptr}/b`, row, inAgg, 'text') as string;
          return ctx.relations.get(name)?.(a, b) === true;
        }
        case 'rand':
          if (typeof node.key !== 'string' || !KEY_PATTERN.test(node.key)) return fail('expr_shape', `${ptr}/key`);
          return seededRand(ctx.seed, ctx.scope, node.key);
        case 'agg':
          return runAgg(node, ptr, inAgg);
        default:
          return fail('expr_shape', `${ptr}/k`, { k: String(node.k) });
      }
    };

    const readRef = (node: Record<string, unknown>, ptr: string, row: ReadonlyMap<string, ExprValue> | null, inAgg: boolean): ExprValue => {
      const name = node.name;
      const t = node.t;
      if (typeof name !== 'string') return fail('expr_shape', `${ptr}/name`);
      if (t !== 'number' && t !== 'boolean' && t !== 'text') return fail('expr_shape', `${ptr}/t`);
      let value: ExprValue | undefined;
      const dot = name.indexOf('.');
      if (dot < 0) {
        value = ctx.refs.get(name);
        if (value === undefined) return fail('expr_unknown_ref', `${ptr}/name`, { name });
      } else {
        if (name.slice(0, dot) !== 'item' || !inAgg || row === null) return fail('expr_item_scope', `${ptr}/name`, { name });
        value = row.get(name.slice(dot + 1));
        if (value === undefined) return fail('expr_unknown_field', `${ptr}/name`, { name });
      }
      const actual = typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ? valueType(value) : null;
      if (actual === null || actual !== t) return fail('expr_ref_type', `${ptr}/t`, { name, expected: t, actual: actual ?? 'invalid' });
      return typeof value === 'number' ? inRange(value, `${ptr}/name`) : value;
    };

    const runAgg = (node: Record<string, unknown>, ptr: string, inAgg: boolean): ExprValue => {
      if (inAgg) return fail('expr_nested_aggregate', ptr);
      const fn = node.fn;
      const over = node.over;
      if (typeof fn !== 'string' || !['count', 'sum', 'min', 'max', 'any', 'all'].includes(fn)) return fail('expr_shape', `${ptr}/fn`);
      if (typeof over !== 'string') return fail('expr_shape', `${ptr}/over`);
      const rows = ctx.collections.get(over);
      if (rows === undefined) return fail('expr_unknown_collection', `${ptr}/over`, { over });
      const hasOf = node.of !== undefined;
      const hasWhere = node.where !== undefined;
      const needsOf = fn === 'sum' || fn === 'min' || fn === 'max';
      if (needsOf && !hasOf) return fail('expr_arity', ptr, { fn, field: 'of', reason: 'missing' });
      if ((fn === 'any' || fn === 'all') && !hasWhere) return fail('expr_arity', ptr, { fn, field: 'where', reason: 'missing' });
      if (!needsOf && hasOf) return fail('expr_arity', `${ptr}/of`, { fn, field: 'of', reason: 'forbidden' });

      let count = 0;
      let total = 0;
      let best: number | null = null;
      for (const row of rows) {
        charge(); // the iteration itself
        if (hasWhere) {
          const keep = bool(node.where, `${ptr}/where`, row, true);
          if (fn === 'any' && keep) return true;
          if (fn === 'all' && !keep) return false;
          if (!keep) continue;
        }
        count += 1;
        if (hasOf) {
          const value = num(node.of, `${ptr}/of`, row, true);
          if (fn === 'sum') total = inRange(total + value, ptr);
          else if (best === null) best = value;
          else best = fn === 'min' ? Math.min(best, value) : Math.max(best, value);
        }
      }
      switch (fn) {
        case 'count':
          return count;
        case 'sum':
          return total;
        case 'any':
          return false;
        case 'all':
          return true;
        default:
          return best ?? 0;
      }
    };

    const value = run(e, '', null, false);
    if (expected !== undefined && valueType(value) !== expected) {
      fail('expr_result_type', '', { expected, actual: valueType(value) });
    }
    return { ok: true, value, steps };
  } catch (error) {
    if (error instanceof EvalFailure) return { ok: false, issue: error.issue, steps };
    // Anything else (a throwing getter, a revoked proxy, a throwing relation) is an invalid tree or context.
    return { ok: false, issue: { code: 'expr_shape', pointer: '', params: {} }, steps };
  }
}
