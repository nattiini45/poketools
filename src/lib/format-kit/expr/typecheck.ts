import { valueType, type CollectionType, type Expr, type ExprIssue, type ExprIssueCode, type ExprType, type TypeEnv } from './ast';
import { KEY_PATTERN } from '../keys';
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

/** Issues reported before the checker stops collecting. */
export const MAX_TYPECHECK_ISSUES = 20;

export type TypeCheckResult =
  | { ok: true; type: ExprType; nodes: number; depth: number; maxSteps: number }
  | { ok: false; issues: ExprIssue[] };

type Params = Record<string, string | number | boolean>;

interface AggScope {
  over: string;
  collection: CollectionType;
}

/** A node typed so far; `null` when its type could not be determined (an issue was reported). */
type Typed = ExprType | null;

const NUMBER_FNS = new Set(['min', 'max']);
const ARITH_OPS = new Set(['+', '-', '*', '/']);
const CMP_OPS = new Set(['<', '<=', '>', '>=', '==', '!=']);
const AGG_FNS = new Set(['count', 'sum', 'min', 'max', 'any', 'all']);
const TYPES = new Set(['number', 'boolean', 'text']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Static check of an expression: types, scopes, arity, literal ranges and the three hard limits
 * (depth, nodes, worst-case steps). Reports every issue found (up to MAX_TYPECHECK_ISSUES), each at
 * a JSON pointer relative to the expression root.
 *
 * It measures first, with an iterative walk, so a hand-built tree that skipped validation (very
 * deep, cyclic, huge) is rejected with `expr_depth` / `expr_nodes` before anything recurses; the
 * recursive check below then never goes deeper than EXPR_MAX_DEPTH.
 *
 * `maxSteps` is the static worst case that `evaluate` can charge: every node outside an aggregate,
 * plus for each aggregate `maxSize * (1 + nodes(where) + nodes(of))`, plus 1.
 */
export function typeCheck(e: Expr, env: TypeEnv, expected?: ExprType): TypeCheckResult {
  try {
    return typeCheckUnsafe(e, env, expected);
  } catch {
    // A getter or proxy that throws: the tree is not a plain AST.
    return { ok: false, issues: [{ code: 'expr_shape', pointer: '', params: {} }] };
  }
}

function typeCheckUnsafe(e: Expr, env: TypeEnv, expected?: ExprType): TypeCheckResult {
  const measure = measureExpr(e);
  const exceeded = exceededLimit(measure);
  if (exceeded !== null) {
    const limit = exceeded === 'expr_depth' ? EXPR_MAX_DEPTH : EXPR_MAX_NODES;
    return { ok: false, issues: [{ code: exceeded, pointer: '', params: { limit } }] };
  }

  const issues: ExprIssue[] = [];
  const report = (code: ExprIssueCode, pointer: string, params: Params = {}): void => {
    if (issues.length < MAX_TYPECHECK_ISSUES) issues.push({ code, pointer, params });
  };

  let outsideNodes = 0;
  let aggSteps = 0;

  /** Check `node`, expecting `want` when given; returns its type. `body` counts nodes inside an aggregate. */
  const check = (node: unknown, ptr: string, scope: AggScope | null, body: { n: number } | null): Typed => {
    if (body !== null) body.n += 1;
    else outsideNodes += 1;
    if (!isObject(node) || typeof node.k !== 'string') {
      report('expr_shape', ptr);
      return null;
    }

    /** Check a child that must have type `want`; reports a mismatch at the child. */
    const expect = (child: unknown, key: string, want: ExprType): void => {
      const got = check(child, `${ptr}/${key}`, scope, body);
      if (got !== null && got !== want) report('expr_type_mismatch', `${ptr}/${key}`, { expected: want, actual: got });
    };
    const list = (field: string): unknown[] | null => {
      const value = node[field];
      if (!Array.isArray(value)) {
        report('expr_shape', `${ptr}/${field}`);
        return null;
      }
      return value;
    };

    switch (node.k) {
      case 'num': {
        const v = node.v;
        if (typeof v !== 'number') report('expr_shape', `${ptr}/v`);
        else if (!Number.isFinite(v) || Math.abs(v) > EXPR_NUM_LIMIT) report('expr_number_range', `${ptr}/v`, { limit: EXPR_NUM_LIMIT });
        return 'number';
      }
      case 'bool':
        if (typeof node.v !== 'boolean') report('expr_shape', `${ptr}/v`);
        return 'boolean';
      case 'str': {
        const v = node.v;
        if (typeof v !== 'string') report('expr_shape', `${ptr}/v`);
        else if (v.length > EXPR_MAX_STRING) report('expr_string_length', `${ptr}/v`, { length: v.length, limit: EXPR_MAX_STRING });
        return 'text';
      }
      case 'ref':
        return checkRef(node, ptr, scope);
      case 'neg':
        expect(node.a, 'a', 'number');
        return 'number';
      case 'arith':
        if (typeof node.op !== 'string' || !ARITH_OPS.has(node.op)) report('expr_shape', `${ptr}/op`);
        expect(node.a, 'a', 'number');
        expect(node.b, 'b', 'number');
        return 'number';
      case 'fn': {
        if (typeof node.fn !== 'string' || !NUMBER_FNS.has(node.fn)) report('expr_shape', `${ptr}/fn`);
        const args = list('args');
        if (args === null) return 'number';
        if (args.length < 2 || args.length > EXPR_MAX_ARGS) report('expr_arity', `${ptr}/args`, { min: 2, max: EXPR_MAX_ARGS, actual: args.length });
        args.forEach((arg, i) => expect(arg, `args/${i}`, 'number'));
        return 'number';
      }
      case 'clamp':
        expect(node.x, 'x', 'number');
        expect(node.lo, 'lo', 'number');
        expect(node.hi, 'hi', 'number');
        return 'number';
      case 'round': {
        expect(node.x, 'x', 'number');
        const d = node.digits;
        if (typeof d !== 'number' || !Number.isInteger(d)) report('expr_shape', `${ptr}/digits`);
        else if (d < 0 || d > EXPR_MAX_ROUND_DIGITS) report('expr_number_range', `${ptr}/digits`, { min: 0, max: EXPR_MAX_ROUND_DIGITS });
        return 'number';
      }
      case 'cmp': {
        if (typeof node.op !== 'string' || !CMP_OPS.has(node.op)) report('expr_shape', `${ptr}/op`);
        const equality = node.op === '==' || node.op === '!=';
        if (equality) {
          const left = check(node.a, `${ptr}/a`, scope, body);
          const right = check(node.b, `${ptr}/b`, scope, body);
          if (left !== null && right !== null && left !== right) report('expr_type_mismatch', `${ptr}/b`, { expected: left, actual: right });
        } else {
          expect(node.a, 'a', 'number');
          expect(node.b, 'b', 'number');
        }
        return 'boolean';
      }
      case 'and':
      case 'or': {
        const args = list('args');
        if (args === null) return 'boolean';
        if (args.length < 2 || args.length > EXPR_MAX_ARGS) report('expr_arity', `${ptr}/args`, { min: 2, max: EXPR_MAX_ARGS, actual: args.length });
        args.forEach((arg, i) => expect(arg, `args/${i}`, 'boolean'));
        return 'boolean';
      }
      case 'not':
        expect(node.a, 'a', 'boolean');
        return 'boolean';
      case 'if': {
        expect(node.cond, 'cond', 'boolean');
        const thenType = check(node.then, `${ptr}/then`, scope, body);
        const elseType = check(node.else, `${ptr}/else`, scope, body);
        if (thenType !== null && elseType !== null && thenType !== elseType) {
          report('expr_type_mismatch', `${ptr}/else`, { expected: thenType, actual: elseType });
        }
        return thenType ?? elseType;
      }
      case 'in':
        return checkIn(node, ptr, scope, body);
      case 'rel': {
        const relation = node.relation;
        if (typeof relation !== 'string' || !KEY_PATTERN.test(relation)) report('expr_shape', `${ptr}/relation`);
        else if (!env.relations.has(relation)) report('expr_unknown_relation', `${ptr}/relation`, { relation });
        expect(node.a, 'a', 'text');
        expect(node.b, 'b', 'text');
        return 'boolean';
      }
      case 'rand':
        if (typeof node.key !== 'string' || !KEY_PATTERN.test(node.key)) report('expr_shape', `${ptr}/key`);
        return 'number';
      case 'agg':
        return checkAgg(node, ptr, scope);
      default:
        report('expr_shape', `${ptr}/k`, { k: node.k });
        return null;
    }
  };

  function checkRef(node: Record<string, unknown>, ptr: string, scope: AggScope | null): Typed {
    const name = node.name;
    const t = node.t;
    if (typeof name !== 'string') {
      report('expr_shape', `${ptr}/name`);
      return null;
    }
    if (typeof t !== 'string' || !TYPES.has(t)) {
      report('expr_shape', `${ptr}/t`);
      return null;
    }
    const declared = t as ExprType;
    const dot = name.indexOf('.');
    if (dot < 0) {
      const actual = env.refs.get(name);
      if (actual === undefined) {
        report('expr_unknown_ref', `${ptr}/name`, { name });
        return declared;
      }
      if (actual !== declared) report('expr_ref_type', `${ptr}/t`, { name, expected: actual, actual: declared });
      return actual;
    }
    // `scope.field`: only `item.field`, and only inside an aggregate's of/where.
    const owner = name.slice(0, dot);
    const field = name.slice(dot + 1);
    if (owner !== 'item' || scope === null) {
      report('expr_item_scope', `${ptr}/name`, { name });
      return declared;
    }
    if (field.includes('.')) {
      report('expr_unknown_ref', `${ptr}/name`, { name });
      return declared;
    }
    const actual = scope.collection.fields.get(field);
    if (actual === undefined) {
      report('expr_unknown_field', `${ptr}/name`, { name, over: scope.over, field });
      return declared;
    }
    if (actual !== declared) report('expr_ref_type', `${ptr}/t`, { name, expected: actual, actual: declared });
    return actual;
  }

  function checkIn(node: Record<string, unknown>, ptr: string, scope: AggScope | null, body: { n: number } | null): Typed {
    const operand = check(node.a, `${ptr}/a`, scope, body);
    const set = node.set;
    if (!Array.isArray(set)) {
      report('expr_shape', `${ptr}/set`);
      return 'boolean';
    }
    if (set.length < 1 || set.length > EXPR_MAX_SET) report('expr_arity', `${ptr}/set`, { min: 1, max: EXPR_MAX_SET, actual: set.length });
    if (operand === 'boolean') report('expr_type_mismatch', `${ptr}/a`, { expected: 'number', actual: 'boolean' });
    // The operand fixes the element type; with no usable operand the first element does.
    const first: unknown = set[0];
    const want: ExprType | null =
      operand === 'number' || operand === 'text' ? operand : typeof first === 'number' ? 'number' : typeof first === 'string' ? 'text' : null;
    set.slice(0, EXPR_MAX_SET + 1).forEach((item: unknown, i) => {
      const at = `${ptr}/set/${i}`;
      if (typeof item !== 'number' && typeof item !== 'string') {
        report('expr_shape', at);
        return;
      }
      const type = valueType(item);
      if (want !== null && type !== want) report('expr_type_mismatch', at, { expected: want, actual: type });
      else if (typeof item === 'number' && (!Number.isFinite(item) || Math.abs(item) > EXPR_NUM_LIMIT)) {
        report('expr_number_range', at, { limit: EXPR_NUM_LIMIT });
      } else if (typeof item === 'string' && item.length > EXPR_MAX_STRING) {
        report('expr_string_length', at, { length: item.length, limit: EXPR_MAX_STRING });
      }
    });
    return 'boolean';
  }

  function checkAgg(node: Record<string, unknown>, ptr: string, scope: AggScope | null): Typed {
    const fn = node.fn;
    const over = node.over;
    if (typeof fn !== 'string' || !AGG_FNS.has(fn)) report('expr_shape', `${ptr}/fn`);
    if (typeof over !== 'string' || !KEY_PATTERN.test(over)) report('expr_shape', `${ptr}/over`);
    const resultType: ExprType = fn === 'any' || fn === 'all' ? 'boolean' : 'number';
    if (scope !== null) {
      report('expr_nested_aggregate', ptr, { over: typeof over === 'string' ? over : '' });
      return resultType;
    }
    const collection = typeof over === 'string' ? env.collections.get(over) : undefined;
    if (collection === undefined) {
      if (typeof over === 'string' && KEY_PATTERN.test(over)) report('expr_unknown_collection', `${ptr}/over`, { over });
      return resultType;
    }
    const inner: AggScope = { over: over as string, collection };

    // Arity: which of `of` / `where` the function takes.
    const hasOf = node.of !== undefined;
    const hasWhere = node.where !== undefined;
    const needsOf = fn === 'sum' || fn === 'min' || fn === 'max';
    const needsWhere = fn === 'any' || fn === 'all';
    if (needsOf && !hasOf) report('expr_arity', ptr, { fn: fn as string, field: 'of', reason: 'missing' });
    if (needsWhere && !hasWhere) report('expr_arity', ptr, { fn: fn as string, field: 'where', reason: 'missing' });
    if (!needsOf && hasOf) report('expr_arity', `${ptr}/of`, { fn: fn as string, field: 'of', reason: 'forbidden' });

    const body = { n: 0 };
    if (hasOf) {
      const got = check(node.of, `${ptr}/of`, inner, body);
      if (got !== null && got !== 'number') report('expr_type_mismatch', `${ptr}/of`, { expected: 'number', actual: got });
    }
    if (hasWhere) {
      const got = check(node.where, `${ptr}/where`, inner, body);
      if (got !== null && got !== 'boolean') report('expr_type_mismatch', `${ptr}/where`, { expected: 'boolean', actual: got });
    }
    // One step for the aggregate node itself (counted by the caller), then per iteration 1 + body.
    aggSteps += collection.maxSize * (1 + body.n);
    return resultType;
  }

  const type = check(e, '', null, null);
  if (type !== null && expected !== undefined && type !== expected) report('expr_result_type', '', { expected, actual: type });

  const maxSteps = outsideNodes + aggSteps + 1;
  if (maxSteps > EXPR_STEP_BUDGET) report('expr_steps', '', { maxSteps, budget: EXPR_STEP_BUDGET });
  if (issues.length > 0 || type === null) {
    return { ok: false, issues: issues.length > 0 ? issues : [{ code: 'expr_shape', pointer: '', params: {} }] };
  }
  return { ok: true, type, nodes: measure.nodes, depth: measure.depth, maxSteps };
}
