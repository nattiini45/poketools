import { KEY_PATTERN, REF_NAME_PATTERN } from '../keys';
import { escapePointerSegment } from '../patch';
import { EXPR_KINDS, type ExprKind, type ExprType } from './ast';
import { EXPR_MAX_ARGS, EXPR_MAX_SET, EXPR_SCHEMA_MAX_DEPTH, EXPR_SCHEMA_MAX_NODES, EXPR_MAX_ROUND_DIGITS } from './limits';
import { exceededLimit, measureExpr } from './measure';

/**
 * Zero-zod, iterative twin of `exprSchema` (schema.ts) for the browser. It reports the same
 * (code, pointer) pairs as the zod schema does after the contract's issue mapping (invalid_type
 * with no input is `required`, other invalid_type is `type`, size checks on arrays are `length`,
 * on numbers `range`, invalid_value is `enum`, invalid_format is `pattern`, unrecognized_keys is
 * one `unknown_key` per key, custom passes its own code). The parity test proves it on mutated
 * input.
 *
 * Only shape is checked here; literal ranges (|x| <= 1e9, strings <= 64) and types belong to
 * `typeCheck`, so they reach the compiler as `expr_*` diagnostics.
 */

export type ExprJsonIssueCode = 'required' | 'type' | 'enum' | 'range' | 'length' | 'pattern' | 'unknown_key' | 'limit';

export interface ExprJsonIssue {
  code: ExprJsonIssueCode;
  /** JSON pointer relative to the expression root. */
  pointer: string;
  params: Record<string, string | number | boolean>;
}

type FieldRule =
  | { t: 'expr'; optional?: true }
  | { t: 'num' }
  | { t: 'bool' }
  | { t: 'str' }
  | { t: 'enum'; values: ReadonlySet<string> }
  | { t: 'pattern'; pattern: 'key' | 'ref' }
  | { t: 'digits' }
  | { t: 'args' }
  | { t: 'set' };

const enumOf = (...values: string[]): FieldRule => ({ t: 'enum', values: new Set(values) });
const EXPR: FieldRule = { t: 'expr' };
const OPTIONAL_EXPR: FieldRule = { t: 'expr', optional: true };

/** Field table per node kind: the data both validators are written from. */
const SHAPES: ReadonlyMap<string, ReadonlyMap<string, FieldRule>> = new Map<string, ReadonlyMap<string, FieldRule>>([
  ['num', new Map([['v', { t: 'num' }]])],
  ['bool', new Map([['v', { t: 'bool' }]])],
  ['str', new Map([['v', { t: 'str' }]])],
  [
    'ref',
    new Map<string, FieldRule>([
      ['name', { t: 'pattern', pattern: 'ref' }],
      ['t', enumOf('number', 'boolean', 'text')],
    ]),
  ],
  ['neg', new Map([['a', EXPR]])],
  [
    'arith',
    new Map<string, FieldRule>([
      ['op', enumOf('+', '-', '*', '/')],
      ['a', EXPR],
      ['b', EXPR],
    ]),
  ],
  [
    'fn',
    new Map<string, FieldRule>([
      ['fn', enumOf('min', 'max')],
      ['args', { t: 'args' }],
    ]),
  ],
  [
    'clamp',
    new Map<string, FieldRule>([
      ['x', EXPR],
      ['lo', EXPR],
      ['hi', EXPR],
    ]),
  ],
  [
    'round',
    new Map<string, FieldRule>([
      ['x', EXPR],
      ['digits', { t: 'digits' }],
    ]),
  ],
  [
    'cmp',
    new Map<string, FieldRule>([
      ['op', enumOf('<', '<=', '>', '>=', '==', '!=')],
      ['a', EXPR],
      ['b', EXPR],
    ]),
  ],
  ['and', new Map([['args', { t: 'args' }]])],
  ['or', new Map([['args', { t: 'args' }]])],
  ['not', new Map([['a', EXPR]])],
  [
    'if',
    new Map<string, FieldRule>([
      ['cond', EXPR],
      ['then', EXPR],
      ['else', EXPR],
    ]),
  ],
  [
    'in',
    new Map<string, FieldRule>([
      ['a', EXPR],
      ['set', { t: 'set' }],
    ]),
  ],
  [
    'rel',
    new Map<string, FieldRule>([
      ['relation', { t: 'pattern', pattern: 'key' }],
      ['a', EXPR],
      ['b', EXPR],
    ]),
  ],
  ['rand', new Map<string, FieldRule>([['key', { t: 'pattern', pattern: 'key' }]])],
  [
    'agg',
    new Map<string, FieldRule>([
      ['fn', enumOf('count', 'sum', 'min', 'max', 'any', 'all')],
      ['over', { t: 'pattern', pattern: 'key' }],
      ['of', OPTIONAL_EXPR],
      ['where', OPTIONAL_EXPR],
    ]),
  ],
]);

const KIND_SET: ReadonlySet<string> = new Set<string>(EXPR_KINDS);

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const fieldOf = (o: object, k: string): unknown => (hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/**
 * The type a node has regardless of its context, or null when it depends on children (`if`) or the
 * node is not well-formed. `exprSchemaFor` uses it to check the root; `typeCheck` does the rest.
 */
export function staticRootType(node: unknown): ExprType | null {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
  const n = node as Record<string, unknown>;
  switch (n.k) {
    case 'bool':
    case 'cmp':
    case 'and':
    case 'or':
    case 'not':
    case 'in':
    case 'rel':
      return 'boolean';
    case 'num':
    case 'arith':
    case 'neg':
    case 'fn':
    case 'clamp':
    case 'round':
    case 'rand':
      return 'number';
    case 'str':
      return 'text';
    case 'ref':
      return n.t === 'number' || n.t === 'boolean' || n.t === 'text' ? n.t : null;
    case 'agg':
      return n.fn === 'any' || n.fn === 'all' ? 'boolean' : n.fn === 'count' || n.fn === 'sum' || n.fn === 'min' || n.fn === 'max' ? 'number' : null;
    default:
      return null;
  }
}

/**
 * zod runs its min/max length checks on any value that has a `length` (a string, or an object with
 * a `length` key), even when the array type check already failed, and compares with plain JS
 * operators. Mirrored here so both validators report the same issues for `"args": ""`.
 */
function lengthOutOfRange(v: unknown, min: number, max: number): boolean {
  if (typeof v !== 'string' && (typeof v !== 'object' || v === null)) return false;
  const length = (v as { length?: unknown }).length as number | undefined;
  if (length === undefined) return false;
  return !(length >= min) || length > max;
}

/**
 * Validate the JSON shape of an expression. Order: trees over EXPR_SCHEMA_MAX_NODES /
 * EXPR_SCHEMA_MAX_DEPTH give a single `limit` issue; then `expected` asserts the root's static type
 * (a single `type` issue at the root) when it is determinable; then the structure is checked.
 * Iterative: a hostile tree cannot overflow the stack.
 */
export function validateExprJson(value: unknown, expected: ExprType | 'any'): ExprJsonIssue[] {
  const limits = { maxNodes: EXPR_SCHEMA_MAX_NODES, maxDepth: EXPR_SCHEMA_MAX_DEPTH };
  const exceeded = exceededLimit(measureExpr(value, limits), limits);
  if (exceeded !== null) return [{ code: 'limit', pointer: '', params: { limit: exceeded } }];
  if (expected !== 'any') {
    // Like the zod root guard: a determinable root type is asserted before the structure is looked at.
    const actual = staticRootType(value);
    if (actual !== null && actual !== expected) return [{ code: 'type', pointer: '', params: { expected, actual } }];
  }

  const issues: ExprJsonIssue[] = [];
  const add = (code: ExprJsonIssueCode, pointer: string, params: ExprJsonIssue['params'] = {}): void => {
    issues.push({ code, pointer, params });
  };
  const stack: { value: unknown; pointer: string }[] = [{ value, pointer: '' }];

  while (stack.length > 0) {
    const { value: node, pointer } = stack.pop() as { value: unknown; pointer: string };
    if (node === undefined) {
      add('required', pointer);
      continue;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      add('type', pointer, { expected: 'object' });
      continue;
    }
    if (!hasOwn(node, 'k')) {
      add('required', `${pointer}/k`);
      continue;
    }
    const k = (node as Record<string, unknown>).k;
    const shape = typeof k === 'string' && KIND_SET.has(k) ? SHAPES.get(k as ExprKind) : undefined;
    if (shape === undefined) {
      add('enum', `${pointer}/k`);
      continue;
    }

    for (const key of Object.keys(node)) {
      if (key !== 'k' && !shape.has(key)) add('unknown_key', `${pointer}/${escapePointerSegment(key)}`, { key });
    }

    shape.forEach((rule, field) => {
      const at = `${pointer}/${field}`;
      const v = fieldOf(node, field);
      if (rule.t === 'expr') {
        if (v === undefined && rule.optional) return;
        stack.push({ value: v, pointer: at });
        return;
      }
      if (v === undefined) {
        // zod reports an absent enum member as an invalid value, everything else as missing.
        add(rule.t === 'enum' ? 'enum' : 'required', at);
        return;
      }
      switch (rule.t) {
        case 'num':
          if (typeof v !== 'number' || !Number.isFinite(v)) add('type', at, { expected: 'number' });
          break;
        case 'bool':
          if (typeof v !== 'boolean') add('type', at, { expected: 'boolean' });
          break;
        case 'str':
          if (typeof v !== 'string') add('type', at, { expected: 'string' });
          break;
        case 'enum':
          if (typeof v !== 'string' || !rule.values.has(v)) add('enum', at);
          break;
        case 'pattern':
          if (typeof v !== 'string') add('type', at, { expected: 'string' });
          else if (!(rule.pattern === 'key' ? KEY_PATTERN : REF_NAME_PATTERN).test(v)) add('pattern', at, { pattern: rule.pattern });
          break;
        case 'digits':
          if (typeof v !== 'number' || !Number.isInteger(v)) add('type', at, { expected: 'integer' });
          else {
            // zod's int() reports an integer beyond the safe range as one more range issue.
            if (!Number.isSafeInteger(v)) add('range', at, { min: 0, max: EXPR_MAX_ROUND_DIGITS });
            if (v < 0 || v > EXPR_MAX_ROUND_DIGITS) add('range', at, { min: 0, max: EXPR_MAX_ROUND_DIGITS });
          }
          break;
        case 'args':
          if (!Array.isArray(v)) {
            add('type', at, { expected: 'array' });
            if (lengthOutOfRange(v, 2, EXPR_MAX_ARGS)) add('length', at, { min: 2, max: EXPR_MAX_ARGS });
            break;
          }
          if (v.length > EXPR_MAX_ARGS) {
            // zod checks the upper bound before parsing items, so an oversized list is not descended into.
            add('length', at, { min: 2, max: EXPR_MAX_ARGS });
            break;
          }
          if (v.length < 2) add('length', at, { min: 2, max: EXPR_MAX_ARGS });
          v.forEach((item: unknown, i) => stack.push({ value: item, pointer: `${at}/${i}` }));
          break;
        case 'set':
          if (!Array.isArray(v)) {
            add('type', at, { expected: 'array' });
            if (lengthOutOfRange(v, 1, EXPR_MAX_SET)) add('length', at, { min: 1, max: EXPR_MAX_SET });
            break;
          }
          if (v.length > EXPR_MAX_SET) {
            add('length', at, { min: 1, max: EXPR_MAX_SET });
            break;
          }
          if (v.length < 1) add('length', at, { min: 1, max: EXPR_MAX_SET });
          v.forEach((item: unknown, i) => {
            if (typeof item !== 'number' && typeof item !== 'string') add('type', `${at}/${i}`, { expected: 'literal' });
          });
          break;
      }
    });
  }

  return issues;
}
