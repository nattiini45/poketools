import { describe, it, expect } from 'vitest';
import {
  assignCoresFromPool,
  CoreAssignmentError,
  CoreNotInPoolError,
  CoreTypesConflictError,
  normalizeTriple,
  type AssignableParticipant,
} from '../core-assignment';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { CoreTriple } from '@/types/season';

function participant(id: string, core: CoreTriple | null = null): AssignableParticipant {
  return { playerId: id, coreTypes: core };
}

const POOL: CoreTriple[] = [
  ['Fire', 'Water', 'Grass'],
  ['Fairy', 'Fighting', 'Steel'],
  ['Psychic', 'Rock', 'Bug'],
  ['Dark', 'Dragon', 'Ghost'],
];

describe('error classes', () => {
  it('are UserFacingError subclasses with codes (safeErrorResponse passthrough)', () => {
    const assignment = new CoreAssignmentError('pool exhausted');
    const conflict = new CoreTypesConflictError(['Fire', 'Water', 'Grass']);
    const notInPool = new CoreNotInPoolError(['Fire', 'Water', 'Grass']);

    expect(assignment).toBeInstanceOf(UserFacingError);
    expect(conflict).toBeInstanceOf(UserFacingError);
    expect(notInPool).toBeInstanceOf(UserFacingError);
    expect(assignment.code).toBe('core_assignment_error');
    expect(conflict.code).toBe('core_types_conflict');
    expect(notInPool.code).toBe('core_not_in_pool');
    expect(assignment.statusCode).toBe(400);
  });

  it('carry the triple as the `types` param, so the client can translate the message', () => {
    expect(new CoreTypesConflictError(['Fire', 'Water', 'Grass']).params).toEqual({ types: 'Fire/Water/Grass' });
    expect(new CoreNotInPoolError(['Fire', 'Water', 'Grass']).params).toEqual({ types: 'Fire/Water/Grass' });
  });
});

describe('error codes per draw failure (errors/seasons)', () => {
  function caught(run: () => unknown): CoreAssignmentError {
    try {
      run();
    } catch (err) {
      if (err instanceof CoreAssignmentError) return err;
      throw err;
    }
    throw new Error('expected a CoreAssignmentError');
  }

  it('an empty pool: core_pool_empty', () => {
    const err = caught(() => assignCoresFromPool([participant('a')], [], { seed: 0 }));
    expect(err.code).toBe('core_pool_empty');
    expect(err.message).toBe('Core pool is empty; cannot draw cores');
  });

  it('a pool too small: core_assignment_error with both counts as params', () => {
    const err = caught(() =>
      assignCoresFromPool(
        [participant('a'), participant('b'), participant('c'), participant('d'), participant('e')],
        POOL,
        { seed: 0 },
      ),
    );
    expect(err.code).toBe('core_assignment_error');
    expect(err.params).toEqual({ available: 4, needed: 5 });
    expect(err.message).toBe('Core pool has 4 available triple(s) but 5 participant(s) need an assignment');
  });

  it('an entry of the wrong length: core_pool_entry_invalid with the entry', () => {
    const err = caught(() =>
      assignCoresFromPool([participant('a')], [['Fire', 'Water'] as unknown as CoreTriple], { seed: 0 }),
    );
    expect(err.code).toBe('core_pool_entry_invalid');
    expect(err.params).toEqual({ entry: '["Fire","Water"]' });
  });

  it('an entry with a repeated type: core_pool_entry_duplicate_types', () => {
    const err = caught(() => assignCoresFromPool([participant('a')], [['Fire', 'Fire', 'Water']], { seed: 0 }));
    expect(err.code).toBe('core_pool_entry_duplicate_types');
    expect(err.params).toEqual({ entry: '["Fire","Fire","Water"]' });
  });

  it('a triple listed twice: core_pool_duplicate_triple with the triple', () => {
    const err = caught(() =>
      assignCoresFromPool(
        [participant('a')],
        [
          ['Fire', 'Water', 'Grass'],
          ['Water', 'Fire', 'Grass'],
        ],
        { seed: 0 },
      ),
    );
    expect(err.code).toBe('core_pool_duplicate_triple');
    expect(err.params).toEqual({ types: 'Water/Fire/Grass' });
  });
});

describe('core-assignment', () => {
  it('assigns a unique triple to each participant from a sufficient pool', () => {
    const result = assignCoresFromPool(
      [participant('a'), participant('b'), participant('c')],
      POOL,
      { seed: 42 },
    );
    expect(result).toHaveLength(3);
    const keys = new Set(result.map((r) => normalizeTriple(r.coreTypes).join('|')));
    expect(keys.size).toBe(3);
  });

  it('is deterministic given the same seed', () => {
    const r1 = assignCoresFromPool(
      [participant('a'), participant('b'), participant('c')],
      POOL,
      { seed: 12345 },
    );
    const r2 = assignCoresFromPool(
      [participant('a'), participant('b'), participant('c')],
      POOL,
      { seed: 12345 },
    );
    expect(r1).toEqual(r2);
  });

  it('produces different results across seeds (sanity check)', () => {
    const r1 = assignCoresFromPool(
      [participant('a'), participant('b'), participant('c'), participant('d')],
      POOL,
      { seed: 1 },
    );
    const r2 = assignCoresFromPool(
      [participant('a'), participant('b'), participant('c'), participant('d')],
      POOL,
      { seed: 2 },
    );
    // 4 ordered outcomes are highly unlikely to match across distinct seeds
    expect(r1.map((r) => r.coreTypes.join('|'))).not.toEqual(r2.map((r) => r.coreTypes.join('|')));
  });

  it('throws when the pool is empty', () => {
    expect(() =>
      assignCoresFromPool([participant('a')], [], { seed: 0 }),
    ).toThrow(CoreAssignmentError);
  });

  it('throws when the pool has fewer triples than participants needing assignment', () => {
    expect(() =>
      assignCoresFromPool(
        [participant('a'), participant('b'), participant('c'), participant('d'), participant('e')],
        POOL,
        { seed: 0 },
      ),
    ).toThrow(CoreAssignmentError);
  });

  it('throws when the pool contains a malformed triple', () => {
    expect(() =>
      assignCoresFromPool(
        [participant('a')],
        [['Fire', 'Fire', 'Water']],
        { seed: 0 },
      ),
    ).toThrow(/duplicate types/);
  });

  it('throws when the pool contains duplicate triples (any permutation)', () => {
    expect(() =>
      assignCoresFromPool(
        [participant('a')],
        [
          ['Fire', 'Water', 'Grass'],
          ['Water', 'Fire', 'Grass'],
        ],
        { seed: 0 },
      ),
    ).toThrow(/duplicate triple/);
  });

  it('skips participants who already have a core when force = false', () => {
    const existing: CoreTriple = ['Fire', 'Water', 'Grass'];
    const result = assignCoresFromPool(
      [participant('a', existing), participant('b'), participant('c')],
      POOL,
      { seed: 7, force: false },
    );
    // Only 2 participants needed assignments
    expect(result.map((r) => r.playerId).sort()).toEqual(['b', 'c']);
    // None of them got the already-taken triple
    const taken = normalizeTriple(existing).join('|');
    for (const r of result) {
      expect(normalizeTriple(r.coreTypes).join('|')).not.toBe(taken);
    }
  });

  it('re-assigns everyone when force = true', () => {
    const existing: CoreTriple = ['Fire', 'Water', 'Grass'];
    const result = assignCoresFromPool(
      [participant('a', existing), participant('b'), participant('c')],
      POOL,
      { seed: 7, force: true },
    );
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.playerId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('on force = true, no participant receives their previous triple (pool >= participants + 1)', () => {
    // Pre-assign every participant to a distinct pool entry. The pool has one
    // unused triple so a swap-out is always possible.
    const preassigned: AssignableParticipant[] = [
      participant('a', POOL[0]),
      participant('b', POOL[1]),
      participant('c', POOL[2]),
    ];
    // Sweep many seeds to exercise different shuffles and verify the
    // collision-avoidance pass holds across them.
    for (let seed = 1; seed <= 100; seed++) {
      const result = assignCoresFromPool(preassigned, POOL, { seed, force: true });
      const byId = new Map(result.map((r) => [r.playerId, normalizeTriple(r.coreTypes).join('|')]));
      for (const p of preassigned) {
        const prev = normalizeTriple(p.coreTypes!).join('|');
        expect(byId.get(p.playerId)).not.toBe(prev);
      }
    }
  });

  it('returns sorted triples (set equality regardless of pool order)', () => {
    const result = assignCoresFromPool(
      [participant('a')],
      [['Water', 'Fire', 'Grass']],
      { seed: 0 },
    );
    // Sorted: Fire, Grass, Water
    expect(result[0].coreTypes).toEqual(['Fire', 'Grass', 'Water']);
  });

  it('throws when pool is too small considering pre-assigned triples', () => {
    // Two of four pool entries are already taken → only 2 left for 3 needs
    const taken1: CoreTriple = ['Fire', 'Water', 'Grass'];
    const taken2: CoreTriple = ['Fairy', 'Fighting', 'Steel'];
    expect(() =>
      assignCoresFromPool(
        [
          participant('a', taken1),
          participant('b', taken2),
          participant('c'),
          participant('d'),
          participant('e'),
        ],
        POOL,
        { seed: 0, force: false },
      ),
    ).toThrow(CoreAssignmentError);
  });
});
