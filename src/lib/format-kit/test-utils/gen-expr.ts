/**
 * Seeded generators for expression tests: well-typed canonical ASTs within the limits, hostile
 * JSON for the shape validators, and a shape-aware mutator. Pure test support, never imported by
 * library code.
 */
import type { CollectionType, Expr, ExprType, TypeEnv } from '../expr/ast';
import { measureExpr } from '../expr/measure';
import { normalizeExpr } from '../expr/normalize';
import { EXPR_MAX_DEPTH, EXPR_STEP_BUDGET } from '../expr/limits';
import { intBetween, pick, type Rng } from './prng';

/** The environment the generators and most expression tests share. */
export const TEST_ENV: TypeEnv = {
  refs: new Map<string, ExprType>([
    ['points', 'number'],
    ['wins', 'number'],
    ['losses', 'number'],
    ['games_played', 'number'],
    ['rank', 'number'],
    ['participants', 'number'],
    ['tag', 'text'],
    ['label', 'text'],
    ['is_seed', 'boolean'],
    ['constructor', 'number'],
  ]),
  collections: new Map<string, CollectionType>([
    [
      'standings',
      {
        fields: new Map<string, ExprType>([
          ['points', 'number'],
          ['wins', 'number'],
          ['losses', 'number'],
          ['name', 'text'],
          ['active', 'boolean'],
        ]),
        maxSize: 16,
      },
    ],
    [
      'players',
      {
        fields: new Map<string, ExprType>([
          ['rating', 'number'],
          ['group', 'text'],
        ]),
        maxSize: 64,
      },
    ],
  ]),
  relations: new Set(['same_group', 'played']),
};

const STRINGS = ['a', 'bb', 'foo bar', 'say "hi"', 'back\\slash', 'ünï', '', 'x'.repeat(64), 'tab\there'];
const KEYS = ['seed_a', 'coin', 'tiebreak', 'k1'];

interface Scope {
  name: string;
  collection: CollectionType;
}

interface State {
  rng: Rng;
  env: TypeEnv;
  /** Remaining static step allowance for aggregates. */
  stepsLeft: number;
}

function split(rng: Rng, total: number, parts: number): number[] {
  const sizes = new Array<number>(parts).fill(1);
  for (let extra = total - parts; extra > 0; extra -= 1) sizes[intBetween(rng, 0, parts - 1)] += 1;
  return sizes;
}

function literalNumber(rng: Rng): number {
  const roll = rng();
  if (roll < 0.5) return intBetween(rng, -50, 50) || 0;
  if (roll < 0.7) return intBetween(rng, -2000, 2000) / 100 || 0;
  if (roll < 0.8) return intBetween(rng, 1, 900) * 1e-7;
  if (roll < 0.9) return intBetween(rng, -1000, 1000) * 1e6 || 0;
  return pick(rng, [1e9, -1e9, 0.5, -0.5, 2.5, 1.005, 123456.789]);
}

function leaf(s: State, type: ExprType, scope: Scope | null): Expr {
  const { rng, env } = s;
  const refs: Expr[] = [];
  env.refs.forEach((t, name) => {
    if (t === type) refs.push({ k: 'ref', name, t });
  });
  if (scope !== null) {
    scope.collection.fields.forEach((t, field) => {
      if (t === type) refs.push({ k: 'ref', name: `item.${field}`, t });
    });
  }
  if (refs.length > 0 && rng() < 0.45) return pick(rng, refs);
  if (type === 'number') return { k: 'num', v: literalNumber(rng) };
  if (type === 'boolean') return { k: 'bool', v: rng() < 0.5 };
  return { k: 'str', v: pick(rng, STRINGS) };
}

function gen(s: State, type: ExprType, depth: number, budget: number, scope: Scope | null): Expr {
  const { rng } = s;
  if (budget < 4 || depth >= EXPR_MAX_DEPTH || rng() < 0.12) return leaf(s, type, scope);

  const choices: (() => Expr)[] = [];
  const kids = (types: ExprType[]): Expr[] => {
    const sizes = split(rng, budget - 1, types.length);
    return types.map((t, i) => gen(s, t, depth + 1, sizes[i], scope));
  };
  const same = (t: ExprType, n: number): ExprType[] => new Array<ExprType>(n).fill(t);

  const ifExpr = (): Expr => {
    const [cond, then, otherwise] = kids(['boolean', type, type]);
    return { k: 'if', cond, then, else: otherwise };
  };
  choices.push(ifExpr);

  if (type === 'number') {
    choices.push(
      () => {
        const [a, b] = kids(same('number', 2));
        return { k: 'arith', op: pick(rng, ['+', '-', '*', '/'] as const), a, b };
      },
      () => {
        const [a, b] = kids(same('number', 2));
        return { k: 'arith', op: pick(rng, ['+', '-'] as const), a, b };
      },
      () => ({ k: 'neg', a: kids(['number'])[0] }),
      () => ({ k: 'fn', fn: pick(rng, ['min', 'max'] as const), args: kids(same('number', intBetween(rng, 2, Math.min(4, budget - 1)))) }),
      () => {
        const [x, lo, hi] = kids(same('number', 3));
        return { k: 'clamp', x, lo, hi };
      },
      () => ({ k: 'round', x: kids(['number'])[0], digits: intBetween(rng, 0, 6) }),
      () => ({ k: 'rand', key: pick(rng, KEYS) }),
    );
    if (scope === null) choices.push(() => genAgg(s, 'number', depth, budget));
  } else if (type === 'boolean') {
    choices.push(
      () => {
        const [a, b] = kids(same('number', 2));
        return { k: 'cmp', op: pick(rng, ['<', '<=', '>', '>='] as const), a, b };
      },
      () => {
        const operandType = pick(rng, ['number', 'text', 'boolean'] as const);
        const [a, b] = kids(same(operandType, 2));
        return { k: 'cmp', op: pick(rng, ['==', '!='] as const), a, b };
      },
      () => ({ k: pick(rng, ['and', 'or'] as const), args: kids(same('boolean', intBetween(rng, 2, Math.min(4, budget - 1)))) }),
      () => ({ k: 'not', a: kids(['boolean'])[0] }),
      () => {
        if (rng() < 0.5) {
          const set = Array.from({ length: intBetween(rng, 1, 5) }, () => intBetween(rng, -20, 20) || 0);
          return { k: 'in', a: kids(['number'])[0], set };
        }
        const set = Array.from({ length: intBetween(rng, 1, 4) }, () => pick(rng, STRINGS));
        return { k: 'in', a: kids(['text'])[0], set };
      },
    );
    if (s.env.relations.size > 0) {
      choices.push(() => {
        const [a, b] = kids(same('text', 2));
        return { k: 'rel', relation: pick(rng, [...s.env.relations]), a, b };
      });
    }
    if (scope === null) choices.push(() => genAgg(s, 'boolean', depth, budget));
  }
  return pick(rng, choices)();
}

function genAgg(s: State, type: ExprType, depth: number, budget: number): Expr {
  const { rng, env } = s;
  const entries = [...env.collections.entries()];
  const [over, collection] = pick(rng, entries);
  const bodyBudget = Math.min(budget - 1, intBetween(rng, 1, 8));
  const cost = (bodyNodes: number): number => collection.maxSize * (1 + bodyNodes);
  if (bodyBudget < 1 || cost(bodyBudget) > s.stepsLeft) return leaf(s, type, null);
  const scope: Scope = { name: over, collection };

  const fn =
    type === 'boolean' ? pick(rng, ['any', 'all'] as const) : pick(rng, ['count', 'sum', 'min', 'max'] as const);
  const wantsOf = fn === 'sum' || fn === 'min' || fn === 'max';
  const wantsWhere = fn === 'any' || fn === 'all' || (rng() < 0.5 && (!wantsOf || bodyBudget >= 2));
  let remaining = bodyBudget;
  const node: Expr = { k: 'agg', fn, over };
  if (wantsOf) {
    const share = wantsWhere && remaining > 1 ? intBetween(rng, 1, remaining - 1) : remaining;
    node.of = gen(s, 'number', depth + 1, share, scope);
    remaining -= share;
  }
  if (wantsWhere) node.where = gen(s, 'boolean', depth + 1, Math.max(1, remaining), scope);
  // Count the body as generated (normalization may only shrink it, so this is an upper bound).
  const used = (node.of === undefined ? 0 : countNodes(node.of)) + (node.where === undefined ? 0 : countNodes(node.where));
  s.stepsLeft -= cost(used);
  return node;
}

const countNodes = (e: Expr): number => measureExpr(e, { maxNodes: 1_000_000, maxDepth: 1_000_000 }).nodes;

/**
 * A well-typed, canonical (normalized) AST of `type` with at most `budget` nodes, depth <= 12 and a
 * static step estimate under the evaluation budget, against `env` (refs and `item.field` refs come
 * from it).
 */
export function genExpr(rng: Rng, env: TypeEnv, type: ExprType, budget: number): Expr {
  const state: State = { rng, env, stepsLeft: EXPR_STEP_BUDGET - 400 };
  return normalizeExpr(gen(state, type, 1, Math.max(1, budget), null));
}

/** A deep copy of JSON-like data (the generators' outputs are plain JSON). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SCALARS: unknown[] = [null, true, false, 0, -1, 1.5, 7, 1e21, '', 'x', 'k', 'item.', '__proto__', [], {}, [1, 2], { k: 'num' }];

/** JSON with a node-level fault injected somewhere: a missing key, an extra key, a wrong type, ... */
export function mutateJson(rng: Rng, value: unknown): unknown {
  const root = cloneJson({ root: value });
  // Collect every container with its parent link, iteratively.
  const containers: { holder: Record<string, unknown> | unknown[]; key: string | number }[] = [];
  const stack: { holder: Record<string, unknown> | unknown[]; key: string | number }[] = [{ holder: root, key: 'root' }];
  while (stack.length > 0) {
    const entry = stack.pop() as { holder: Record<string, unknown> | unknown[]; key: string | number };
    const child = (entry.holder as Record<string | number, unknown>)[entry.key];
    containers.push(entry);
    if (typeof child === 'object' && child !== null) {
      for (const k of Object.keys(child)) stack.push({ holder: child as Record<string, unknown>, key: k });
    }
  }
  const target = pick(rng, containers);
  const slot = target.holder as Record<string | number, unknown>;
  const current = slot[target.key];
  const isObject = typeof current === 'object' && current !== null && !Array.isArray(current);
  const isArray = Array.isArray(current);
  const roll = rng();
  if (roll < 0.2 && typeof target.key === 'string' && !Array.isArray(target.holder) && target.key !== 'root') {
    delete slot[target.key];
  } else if (roll < 0.35 && isObject) {
    // defineProperty so an own `__proto__` key is data, as JSON.parse would create it.
    Object.defineProperty(current, pick(rng, ['extra', 'zz', 'a', 'k2', '__proto__']), { value: pick(rng, SCALARS), enumerable: true, configurable: true, writable: true });
  } else if (roll < 0.6) {
    slot[target.key] = pick(rng, SCALARS);
  } else if (roll < 0.7 && isArray) {
    slot[target.key] = (current as unknown[]).slice(0, intBetween(rng, 0, 1));
  } else if (roll < 0.8 && isArray) {
    const items = current as unknown[];
    slot[target.key] = [...items, ...Array.from({ length: intBetween(rng, 1, 9) }, () => (items.length > 0 ? cloneJson(items[0]) : null))];
  } else if (roll < 0.9 && isObject) {
    (current as Record<string, unknown>).k = pick(rng, ['zzz', 'NUM', 'num', 'neg', 'and', 3, null]);
  } else {
    let nested: unknown = current;
    for (let i = intBetween(rng, 5, 45); i > 0; i -= 1) nested = { k: 'neg', a: nested };
    slot[target.key] = nested;
  }
  return (root as { root?: unknown }).root;
}

/** Hostile JSON for the shape validators: deep, wide, ill-typed, unknown keys, bad kinds. */
export function genHostile(rng: Rng): unknown {
  const roll = rng();
  if (roll < 0.15) {
    let deep: unknown = { k: 'num', v: 1 };
    for (let i = intBetween(rng, 12, 60); i > 0; i -= 1) deep = { k: 'neg', a: deep };
    return deep;
  }
  if (roll < 0.3) {
    return { k: pick(rng, ['and', 'or', 'fn'] as const), ...(rng() < 0.5 ? { fn: 'min' } : {}), args: Array.from({ length: intBetween(rng, 0, 40) }, () => ({ k: 'num', v: 1 })) };
  }
  if (roll < 0.45) return { k: 'num', v: pick(rng, ['1', null, true, [], {}, 1e999]) };
  if (roll < 0.6) return { k: 'arith', op: pick(rng, ['^', '%', '', 1]), a: { k: 'num', v: 1 }, b: { k: 'num', v: 2 } };
  if (roll < 0.7) return JSON.parse('{"k":"num","v":1,"__proto__":{"polluted":true}}');
  if (roll < 0.8) return { k: 'ref', name: pick(rng, ['Points', 'a.b.c', '__proto__', 'x'.repeat(40), 'item.']), t: pick(rng, ['number', 'string', 'text']) };
  if (roll < 0.9) return { k: 'in', a: { k: 'num', v: 1 }, set: Array.from({ length: intBetween(rng, 0, 40) }, () => pick(rng, [1, 'a', true, null])) };
  return pick(rng, SCALARS);
}

type Cmp = Extract<Expr, { k: 'cmp' }>['op'];
type Arith = Extract<Expr, { k: 'arith' }>['op'];
type AggFn = Extract<Expr, { k: 'agg' }>['fn'];

/** Short AST builders so tests read like the expressions they check. */
export const x = {
  num: (v: number): Expr => ({ k: 'num', v }),
  bool: (v: boolean): Expr => ({ k: 'bool', v }),
  str: (v: string): Expr => ({ k: 'str', v }),
  ref: (name: string, t: ExprType = 'number'): Expr => ({ k: 'ref', name, t }),
  item: (field: string, t: ExprType = 'number'): Expr => ({ k: 'ref', name: `item.${field}`, t }),
  neg: (a: Expr): Expr => ({ k: 'neg', a }),
  arith: (op: Arith, a: Expr, b: Expr): Expr => ({ k: 'arith', op, a, b }),
  fn: (fn: 'min' | 'max', ...args: Expr[]): Expr => ({ k: 'fn', fn, args }),
  clamp: (v: Expr, lo: Expr, hi: Expr): Expr => ({ k: 'clamp', x: v, lo, hi }),
  round: (v: Expr, digits = 0): Expr => ({ k: 'round', x: v, digits }),
  cmp: (op: Cmp, a: Expr, b: Expr): Expr => ({ k: 'cmp', op, a, b }),
  and: (...args: Expr[]): Expr => ({ k: 'and', args }),
  or: (...args: Expr[]): Expr => ({ k: 'or', args }),
  not: (a: Expr): Expr => ({ k: 'not', a }),
  ifx: (cond: Expr, then: Expr, otherwise: Expr): Expr => ({ k: 'if', cond, then, else: otherwise }),
  inSet: (a: Expr, set: (number | string)[]): Expr => ({ k: 'in', a, set }),
  rel: (relation: string, a: Expr, b: Expr): Expr => ({ k: 'rel', relation, a, b }),
  rand: (key: string): Expr => ({ k: 'rand', key }),
  agg: (fn: AggFn, over: string, parts: { of?: Expr; where?: Expr } = {}): Expr => ({ k: 'agg', fn, over, ...parts }),
  /** A chain of `levels` nodes (depth exactly `levels`): neg(neg(...num)). */
  chain: (levels: number): Expr => {
    let e: Expr = { k: 'num', v: 1 };
    for (let i = 1; i < levels; i += 1) e = { k: 'neg', a: e };
    return e;
  },
  /** A bushy number expression of exactly `nodes` nodes (depth stays small). */
  nodes: (nodes: number): Expr => {
    if (nodes <= 1) return { k: 'num', v: 1 };
    if (nodes === 2) return { k: 'neg', a: { k: 'num', v: 1 } };
    const children = Math.min(8, nodes - 1);
    const sizes = new Array<number>(children).fill(Math.floor((nodes - 1) / children));
    for (let i = 0; i < (nodes - 1) % children; i += 1) sizes[i] += 1;
    return { k: 'fn', fn: 'max', args: sizes.map((size) => x.nodes(size)) };
  },
};
