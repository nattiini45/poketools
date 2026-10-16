import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `updateParticipantSeeds` against a stateful fake of `tournament_participants`
 * that enforces `tournament_participants_seed_unique` the way Postgres does for
 * a non-deferrable index: each row is checked as it is written, so an UPDATE
 * that hands seed 1 to a player while another still holds it fails.
 */

type Row = { tournament_id: string; player_id: string; seed: number | null; starting_bracket: string };

const state = vi.hoisted(() => ({
  rows: [] as Array<{ tournament_id: string; player_id: string; seed: number | null; starting_bracket: string }>,
  statements: [] as string[],
  /** player ids whose per-row UPDATE fails with an injected error */
  failWritesFor: new Set<string>(),
  failRead: null as Error | null,
  failClear: null as Error | null,
  /** the `tournaments` row's enrollment_source (null: a manual phase) */
  enrollmentSource: null as Record<string, unknown> | null,
  /** patches written to the `tournaments` row (freezeEnrollment) */
  tournamentUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => {
  type Filter = { col: string; op: 'eq' | 'in'; value: unknown };

  function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
    return filters.every((f) =>
      f.op === 'eq' ? row[f.col] === f.value : (f.value as unknown[]).includes(row[f.col]),
    );
  }

  function uniqueViolation() {
    return { message: 'duplicate key value violates unique constraint "tournament_participants_seed_unique"', code: '23505' };
  }

  function runUpdate(patch: Record<string, unknown>, filters: Filter[]) {
    const playerFilter = filters.find((f) => f.col === 'player_id' && f.op === 'eq');
    if (playerFilter && state.failWritesFor.has(playerFilter.value as string)) {
      return { data: null, error: { message: 'injected write failure', code: 'XX000' } };
    }
    if (patch.seed === null && filters.some((f) => f.op === 'in') && state.failClear) {
      return { data: null, error: state.failClear };
    }
    // Statement atomicity: work on a copy, commit only if every row passes.
    const next = state.rows.map((row) => ({ ...row }));
    for (const row of next) {
      if (!matches(row, filters)) continue;
      Object.assign(row, patch);
      if (row.seed !== null) {
        const clash = next.some(
          (other) => other !== row && other.tournament_id === row.tournament_id && other.seed === row.seed,
        );
        if (clash) return { data: null, error: uniqueViolation() };
      }
    }
    state.rows = next;
    return { data: null, error: null };
  }

  function builder(table: string) {
    let mode: 'select' | 'update' = 'select';
    let patch: Record<string, unknown> = {};
    const filters: Filter[] = [];
    const exec = () => {
      if (table === 'tournaments') {
        if (mode === 'update') {
          state.tournamentUpdates.push(patch);
          return { data: null, error: null };
        }
        return {
          data: { id: 't1', enrollment_source: state.enrollmentSource, seasons: null },
          error: null,
        };
      }
      if (mode === 'select') {
        state.statements.push('select');
        if (state.failRead) return { data: null, error: state.failRead };
        return {
          data: state.rows
            .filter((row) => matches(row, filters))
            .map((row) => ({ player_id: row.player_id, seed: row.seed })),
          error: null,
        };
      }
      state.statements.push(
        `update ${JSON.stringify(patch)} ${filters
          .filter((f) => f.col === 'player_id')
          .map((f) => `${f.op}:${JSON.stringify(f.value)}`)
          .join(' ')}`,
      );
      return runUpdate(patch, filters);
    };
    const b = {
      select: () => b,
      update: (p: Record<string, unknown>) => {
        mode = 'update';
        patch = p;
        return b;
      },
      eq: (col: string, value: unknown) => {
        filters.push({ col, op: 'eq', value });
        return b;
      },
      in: (col: string, value: unknown[]) => {
        filters.push({ col, op: 'in', value });
        return b;
      },
      maybeSingle: () => Promise.resolve(exec()),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return b;
  }

  return { supabase: { from: (table: string) => builder(table) } };
});

import {
  updateParticipantSeeds,
  SeedConflictError,
  SeedUpdatePartialError,
} from '../tournaments';

function seed(rows: Array<[string, number | null]>, tournamentId = 't1'): void {
  state.rows = rows.map(([player_id, s]) => ({
    tournament_id: tournamentId,
    player_id,
    seed: s,
    starting_bracket: 'winners',
  }));
}

function seedsOf(tournamentId = 't1'): Record<string, number | null> {
  return Object.fromEntries(
    state.rows.filter((r) => r.tournament_id === tournamentId).map((r) => [r.player_id, r.seed]),
  );
}

beforeEach(() => {
  state.rows = [];
  state.statements = [];
  state.failWritesFor = new Set();
  state.failRead = null;
  state.failClear = null;
  state.enrollmentSource = null;
  state.tournamentUpdates = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('updateParticipantSeeds', () => {
  it('does nothing for an empty request', async () => {
    seed([['p1', 1]]);
    await updateParticipantSeeds('t1', []);
    expect(state.statements).toEqual([]);
  });

  it('swaps seeds 1 <-> 2 without hitting the unique index', async () => {
    seed([['p1', 1], ['p2', 2], ['p3', 3]]);

    await updateParticipantSeeds('t1', [
      { player_id: 'p1', seed: 2 },
      { player_id: 'p2', seed: 1 },
    ]);

    expect(seedsOf()).toEqual({ p1: 2, p2: 1, p3: 3 });
    // read, one clear statement for both movers, then the two writes
    expect(state.statements[0]).toBe('select');
    expect(state.statements[1]).toBe('update {"seed":null} in:["p1","p2"]');
    expect(state.statements.slice(2).sort()).toEqual([
      'update {"seed":1} eq:"p2"',
      'update {"seed":2} eq:"p1"',
    ]);
  });

  it('rotates a full reseed (seed-by-rating) collision-free', async () => {
    seed([['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4]]);

    await updateParticipantSeeds('t1', [
      { player_id: 'p4', seed: 1 },
      { player_id: 'p1', seed: 2 },
      { player_id: 'p2', seed: 3 },
      { player_id: 'p3', seed: 4 },
    ]);

    expect(seedsOf()).toEqual({ p4: 1, p1: 2, p2: 3, p3: 4 });
  });

  it('leaves unchanged rows unwritten and writes starting_bracket only when provided', async () => {
    seed([['p1', 1], ['p2', 2]]);

    await updateParticipantSeeds('t1', [
      { player_id: 'p1', seed: 1 },
      { player_id: 'p2', seed: 2, starting_bracket: 'losers' },
    ]);

    expect(state.statements).toEqual([
      'select',
      'update {"seed":2,"starting_bracket":"losers"} eq:"p2"',
    ]);
    expect(state.rows.find((r) => r.player_id === 'p2')?.starting_bracket).toBe('losers');
    expect(state.rows.find((r) => r.player_id === 'p1')?.starting_bracket).toBe('winners');
  });

  it('clears a seed set to null with the clear statement alone', async () => {
    seed([['p1', 1], ['p2', 2]]);

    await updateParticipantSeeds('t1', [{ player_id: 'p2', seed: null }]);

    expect(seedsOf()).toEqual({ p1: 1, p2: null });
    expect(state.statements).toEqual(['select', 'update {"seed":null} in:["p2"]']);
  });

  it('rejects a seed held by a player outside the request with SeedConflictError and writes nothing', async () => {
    seed([['p1', 1], ['p2', 2], ['p3', 3]]);

    const err = await updateParticipantSeeds('t1', [{ player_id: 'p1', seed: 3 }]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SeedConflictError);
    expect(err).toMatchObject({ code: 'SEED_CONFLICT', statusCode: 409 });
    expect(state.statements).toEqual(['select']);
    expect(seedsOf()).toEqual({ p1: 1, p2: 2, p3: 3 });
  });

  it('ignores player ids that are not enrolled', async () => {
    seed([['p1', 1]]);

    await updateParticipantSeeds('t1', [
      { player_id: 'ghost', seed: 1 },
      { player_id: 'p1', seed: 2 },
    ]);

    expect(seedsOf()).toEqual({ p1: 2 });
  });

  it('rethrows the read error without writing', async () => {
    seed([['p1', 1], ['p2', 2]]);
    state.failRead = new Error('read err');

    await expect(
      updateParticipantSeeds('t1', [
        { player_id: 'p1', seed: 2 },
        { player_id: 'p2', seed: 1 },
      ]),
    ).rejects.toThrow('read err');
    expect(seedsOf()).toEqual({ p1: 1, p2: 2 });
  });

  it('rethrows a failed clear as the original error (nothing written)', async () => {
    seed([['p1', 1], ['p2', 2]]);
    state.failClear = new Error('clear err');

    const err = await updateParticipantSeeds('t1', [
      { player_id: 'p1', seed: 2 },
      { player_id: 'p2', seed: 1 },
    ]).catch((e: unknown) => e);

    expect(err).toBe(state.failClear);
    expect(err).not.toBeInstanceOf(SeedUpdatePartialError);
    expect(seedsOf()).toEqual({ p1: 1, p2: 2 });
  });

  it('reports a write failure after the clear as SeedUpdatePartialError', async () => {
    seed([['p1', 1], ['p2', 2]]);
    state.failWritesFor = new Set(['p2']);

    const err = await updateParticipantSeeds('t1', [
      { player_id: 'p1', seed: 2 },
      { player_id: 'p2', seed: 1 },
    ]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SeedUpdatePartialError);
    expect(err).toMatchObject({ code: 'SEED_UPDATE_PARTIAL', statusCode: 500, failedPlayerIds: ['p2'] });
    expect(seedsOf()).toEqual({ p1: 2, p2: null });
    expect(console.error).toHaveBeenCalledWith(
      '[updateParticipantSeeds] Partial seed write:',
      expect.any(Array),
    );
  });

  it('rethrows the original error when nothing was written', async () => {
    seed([['p1', null]]);
    state.failWritesFor = new Set(['p1']);

    const err = await updateParticipantSeeds('t1', [{ player_id: 'p1', seed: 1 }]).catch((e: unknown) => e);

    expect(err).toMatchObject({ message: 'injected write failure' });
    expect(err).not.toBeInstanceOf(SeedUpdatePartialError);
  });

  describe('enrollment freeze', () => {
    const synced = { type: 'standings', source_phase_id: 'p0', synced_at: '2025-01-01T00:00:00Z', frozen: false };

    it('freezes a synced enrollment after writing seeds', async () => {
      seed([['p1', 1], ['p2', 2]]);
      state.enrollmentSource = synced;

      await updateParticipantSeeds('t1', [
        { player_id: 'p1', seed: 2 },
        { player_id: 'p2', seed: 1 },
      ]);

      expect(state.tournamentUpdates).toEqual([{ enrollment_source: { ...synced, frozen: true } }]);
    });

    it('freezes a synced enrollment on a save that changes nothing', async () => {
      // The admin confirmed the standings order (or seed-by-rating matched
      // it): no seed row is written, but the seeding is now the admin's.
      seed([['p1', 1], ['p2', 2]]);
      state.enrollmentSource = synced;

      await updateParticipantSeeds('t1', [
        { player_id: 'p1', seed: 1 },
        { player_id: 'p2', seed: 2 },
      ]);

      expect(state.statements).toEqual(['select']);
      expect(state.tournamentUpdates).toEqual([{ enrollment_source: { ...synced, frozen: true } }]);
    });

    it('does not freeze when a seed write fails', async () => {
      seed([['p1', null]]);
      state.enrollmentSource = synced;
      state.failWritesFor = new Set(['p1']);

      await updateParticipantSeeds('t1', [{ player_id: 'p1', seed: 1 }]).catch(() => undefined);

      expect(state.tournamentUpdates).toEqual([]);
    });

    it('does not freeze for an empty request', async () => {
      seed([['p1', 1]]);
      state.enrollmentSource = synced;

      await updateParticipantSeeds('t1', []);

      expect(state.tournamentUpdates).toEqual([]);
    });
  });

  it('only touches the requested tournament', async () => {
    seed([['p1', 1], ['p2', 2]]);
    state.rows.push(
      { tournament_id: 't2', player_id: 'p1', seed: 1, starting_bracket: 'winners' } satisfies Row,
      { tournament_id: 't2', player_id: 'p2', seed: 2, starting_bracket: 'winners' } satisfies Row,
    );

    await updateParticipantSeeds('t1', [
      { player_id: 'p1', seed: 2 },
      { player_id: 'p2', seed: 1 },
    ]);

    expect(seedsOf('t1')).toEqual({ p1: 2, p2: 1 });
    expect(seedsOf('t2')).toEqual({ p1: 1, p2: 2 });
  });
});
