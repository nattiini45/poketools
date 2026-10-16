/**
 * Core Liga: random assignment of curated 3-type cores to season participants.
 *
 * The pool is a curated list of triples on `seasons.core_pool`. Each player
 * receives one triple from the pool; once assigned, that triple is removed
 * from the pool of options. The shuffle is seedable so tests and replays can
 * reproduce a particular draw.
 *
 * See `docs/poketools-spec.md` §9.1 and the
 * `supabase/migrations/20260526092410_team_constraints_and_cores.sql`
 * migration for the storage layout.
 */
import { randomInt } from 'node:crypto';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { CoreTriple } from '@/types/season';

export interface AssignableParticipant {
  playerId: string;
  /** Existing core, if previously drawn. Skipped unless `force` is true. */
  coreTypes: CoreTriple | null;
}

export interface CoreAssignment {
  playerId: string;
  coreTypes: CoreTriple;
}

export interface AssignOptions {
  /** When true, re-roll cores for participants who already have one. */
  force?: boolean;
  /** Optional seed for the deterministic shuffle. */
  seed?: number;
}

/**
 * The draw's failure causes, one `errors/seasons` code each.
 * `core_assignment_error` (the default) is the pool too small for the
 * participants who need a core.
 */
export type CoreAssignmentErrorCode =
  | 'core_assignment_error'
  | 'core_pool_empty'
  | 'core_pool_entry_invalid'
  | 'core_pool_entry_duplicate_types'
  | 'core_pool_duplicate_triple';

export class CoreAssignmentError extends UserFacingError<CoreAssignmentErrorCode> {
  constructor(
    message: string,
    code: CoreAssignmentErrorCode = 'core_assignment_error',
    params?: Readonly<Record<string, string | number>>,
  ) {
    super(message, { code, params });
    this.name = 'CoreAssignmentError';
  }
}

export class CoreTypesConflictError extends UserFacingError {
  readonly triple: CoreTriple;

  constructor(triple: CoreTriple) {
    super(`${triple.join('/')} is already assigned to another participant`, {
      code: 'core_types_conflict',
      params: { types: triple.join('/') },
    });
    this.name = 'CoreTypesConflictError';
    this.triple = triple;
  }
}

export class CoreNotInPoolError extends UserFacingError {
  readonly triple: CoreTriple;

  constructor(triple: CoreTriple) {
    super(`${triple.join('/')} is not in the season core pool`, {
      code: 'core_not_in_pool',
      params: { types: triple.join('/') },
    });
    this.name = 'CoreNotInPoolError';
    this.triple = triple;
  }
}

/**
 * Mulberry32 — a tiny, fast, deterministic 32-bit PRNG.
 * Returns a float in [0, 1).
 */
function createRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sort a triple's types alphabetically so set equality is order-independent. */
export function normalizeTriple(t: CoreTriple): CoreTriple {
  const sorted = [...t].sort();
  return [sorted[0], sorted[1], sorted[2]] as CoreTriple;
}

export function tripleKey(t: CoreTriple): string {
  return normalizeTriple(t).join('|');
}

export function isTripleInPool(pool: CoreTriple[], triple: CoreTriple): boolean {
  const key = tripleKey(triple);
  return pool.some((entry) => tripleKey(entry) === key);
}

/**
 * Assign a random core to every participant who doesn't have one yet (or to
 * everyone when `force = true`). The result preserves the participants array
 * order so callers can write back row-by-row.
 *
 * Throws `CoreAssignmentError` when the pool is smaller than the number of
 * participants needing a core, or when the pool is empty, or when any pool
 * entry is malformed (not 3 distinct types).
 */
export function assignCoresFromPool(
  participants: AssignableParticipant[],
  pool: CoreTriple[],
  opts: AssignOptions = {},
): CoreAssignment[] {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new CoreAssignmentError('Core pool is empty; cannot draw cores', 'core_pool_empty');
  }

  // Validate pool entries
  const seenKeys = new Set<string>();
  for (const triple of pool) {
    if (!Array.isArray(triple) || triple.length !== 3) {
      const entry = JSON.stringify(triple);
      throw new CoreAssignmentError(`Pool entry has wrong length: ${entry}`, 'core_pool_entry_invalid', {
        entry,
      });
    }
    if (triple[0] === triple[1] || triple[0] === triple[2] || triple[1] === triple[2]) {
      const entry = JSON.stringify(triple);
      throw new CoreAssignmentError(
        `Pool entry contains duplicate types: ${entry}`,
        'core_pool_entry_duplicate_types',
        { entry },
      );
    }
    const key = tripleKey(triple);
    if (seenKeys.has(key)) {
      const types = triple.join('/');
      throw new CoreAssignmentError(`Pool contains duplicate triple: ${types}`, 'core_pool_duplicate_triple', {
        types,
      });
    }
    seenKeys.add(key);
  }

  const force = opts.force === true;
  const targets = participants.filter((p) => force || p.coreTypes === null);

  // Determine which pool entries are already taken (when not forcing)
  const taken = new Set<string>();
  if (!force) {
    for (const p of participants) {
      if (p.coreTypes) taken.add(tripleKey(p.coreTypes));
    }
  }

  const available = pool.filter((t) => !taken.has(tripleKey(t)));
  if (available.length < targets.length) {
    throw new CoreAssignmentError(
      `Core pool has ${available.length} available triple(s) but ${targets.length} participant(s) need an assignment`,
      'core_assignment_error',
      { available: available.length, needed: targets.length },
    );
  }

  // Fisher–Yates shuffle with seedable RNG. Explicit opts.seed (including 0)
  // wins for tests/replays; otherwise we use crypto for unpredictability —
  // Math.random() is not designed for that and is the documented source of
  // test/mock leakage in shared modules.
  const seed = opts.seed ?? randomInt(0, 0x7fffffff);
  const rng = createRng(seed);
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // On force re-roll, make a best-effort pass to avoid handing a player the
  // exact triple they just had. For each colliding target slot i, swap with
  // any other shuffled slot j where neither side ends up re-collided. Swap
  // partners include unused slots (j >= targets.length) — those slots have no
  // assigned participant so they impose no constraint on what `shuffled[i]`
  // becomes. In the unsolvable corner (pool == targets and every swap also
  // collides) the row keeps its draw — we never throw.
  if (force) {
    const previous = new Map<string, string>();
    for (const p of participants) {
      if (p.coreTypes) previous.set(p.playerId, tripleKey(p.coreTypes));
    }
    for (let i = 0; i < targets.length; i++) {
      const prevKey = previous.get(targets[i].playerId);
      if (!prevKey || tripleKey(shuffled[i]) !== prevKey) continue;
      for (let j = 0; j < shuffled.length; j++) {
        if (j === i) continue;
        // The candidate slot must not hold targets[i]'s previous triple.
        if (tripleKey(shuffled[j]) === prevKey) continue;
        // If slot j is also assigned to a target, that target must be able to
        // accept what's currently in slot i (i.e. not their previous triple).
        if (j < targets.length) {
          const otherPrev = previous.get(targets[j].playerId);
          if (otherPrev && tripleKey(shuffled[i]) === otherPrev) continue;
        }
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        break;
      }
    }
  }

  const assignments: CoreAssignment[] = [];
  for (let i = 0; i < targets.length; i++) {
    assignments.push({
      playerId: targets[i].playerId,
      coreTypes: normalizeTriple(shuffled[i]),
    });
  }
  return assignments;
}
