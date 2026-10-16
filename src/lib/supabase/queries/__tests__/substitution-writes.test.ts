/**
 * The query helpers the substitution and the group repair write and read
 * through (PR #65 test-pass follow-ups): the server-filtered, paged reads,
 * the conditional writes, and the 409s a concurrent change maps to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';

interface RecordedQuery {
  table: string;
  calls: Array<[method: string, ...args: unknown[]]>;
}

const { fake } = vi.hoisted(() => {
  const state = {
    queries: [] as RecordedQuery[],
    /** Results per table, consumed in order; each awaited query takes one. */
    results: new Map<string, unknown[]>(),
  };
  const methods = ['select', 'eq', 'or', 'in', 'order', 'range', 'limit', 'update', 'delete', 'insert'];
  function from(table: string) {
    const query: RecordedQuery = { table, calls: [] };
    state.queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of methods) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => void, reject: (err: unknown) => void) => {
      const queue = state.results.get(table) ?? [];
      if (queue.length === 0) {
        reject(new Error(`no result queued for ${table}`));
        return;
      }
      resolve(queue.shift());
    };
    return builder;
  }
  return { fake: { state, from } };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: fake.from } }));
vi.mock('@/lib/utils/uuid', () => ({ assertValidUuid: vi.fn() }));
// seasons.ts imports React's cache(); outside a render it is a pass-through.
vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }));

import {
  getScheduledMatchesForPlayerInTournament,
  getTournamentPairings,
  repairScheduledMatchPairing,
} from '../matches';
import { handOverGroupRow } from '../tournament-groups';
import { swapSeasonParticipant } from '../seasons';

function queue(table: string, ...results: unknown[]) {
  fake.state.results.set(table, [...(fake.state.results.get(table) ?? []), ...results]);
}

function queriesOn(table: string): RecordedQuery[] {
  return fake.state.queries.filter((query) => query.table === table);
}

function callsOf(query: RecordedQuery, method: string): unknown[][] {
  return query.calls.filter(([name]) => name === method).map(([, ...args]) => args);
}

function matchRow(id: string) {
  return {
    id,
    round_id: 'r1',
    tournament_id: 't1',
    player_1_id: 'p-out',
    player_2_id: 'p-x',
    winner_id: null,
    status: 'scheduled',
    player_1: { name: 'Out' },
    player_2: { name: 'X' },
    winner: null,
    games: [],
    round: { status: 'active' },
  };
}

beforeEach(() => {
  fake.state.queries.length = 0;
  fake.state.results.clear();
});

describe('getScheduledMatchesForPlayerInTournament', () => {
  it("filters to the player's scheduled matches on the server, ordered, and pages past max_rows", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => matchRow(`m-${index}`));
    queue('matches', { data: firstPage, error: null }, { data: [matchRow('m-1000')], error: null });

    const matches = await getScheduledMatchesForPlayerInTournament('t1', 'p-out');

    expect(matches).toHaveLength(1001);
    const [first, second] = queriesOn('matches');
    expect(callsOf(first, 'eq')).toEqual([
      ['tournament_id', 't1'],
      ['status', 'scheduled'],
    ]);
    expect(callsOf(first, 'or')).toEqual([['player_1_id.eq.p-out,player_2_id.eq.p-out']]);
    expect(callsOf(first, 'order')).toEqual([
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(callsOf(first, 'range')).toEqual([[0, 999]]);
    expect(callsOf(second, 'range')).toEqual([[1000, 1999]]);
    expect(callsOf(first, 'limit')).toEqual([]);
  });

  it('reads one page when it is short', async () => {
    queue('matches', { data: [matchRow('m-1')], error: null });

    await getScheduledMatchesForPlayerInTournament('t1', 'p-out');

    expect(queriesOn('matches')).toHaveLength(1);
  });
});

describe('getTournamentPairings', () => {
  it('reads only the two player ids, ordered, paging until a short page', async () => {
    const full = Array.from({ length: 1000 }, () => ({ player_1_id: 'a', player_2_id: 'b' }));
    queue('matches', { data: full, error: null }, { data: full.slice(0, 3), error: null });

    const result = await getTournamentPairings('t1');

    expect(result).toEqual({ pairings: [...full, ...full.slice(0, 3)], truncated: false });
    const [first] = queriesOn('matches');
    expect(callsOf(first, 'select')).toEqual([['player_1_id, player_2_id']]);
    expect(callsOf(first, 'order')).toEqual([
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('stops at its bound and says the read is truncated', async () => {
    const full = Array.from({ length: 1000 }, () => ({ player_1_id: 'a', player_2_id: 'b' }));
    for (let page = 0; page < 20; page++) queue('matches', { data: full, error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getTournamentPairings('t1');

    expect(queriesOn('matches')).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(result.pairings).toHaveLength(20000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('repairScheduledMatchPairing', () => {
  const expected = { player_1_id: 'p-out', player_2_id: 'p-x' };
  const next = { player_1_id: 'p-in', player_2_id: 'p-x' };

  it('re-pairs only while the match is scheduled between the expected players', async () => {
    queue('games', { count: 0, error: null });
    queue('matches', { data: [{ id: 'm1' }], error: null });

    expect(await repairScheduledMatchPairing('m1', expected, next)).toBe('repaired');

    const [update] = queriesOn('matches');
    expect(callsOf(update, 'update')[0][0]).toMatchObject({ player_1_id: 'p-in', player_2_id: 'p-x' });
    expect(callsOf(update, 'update')[0][0]).not.toHaveProperty('status');
    expect(callsOf(update, 'eq')).toEqual([
      ['id', 'm1'],
      ['status', 'scheduled'],
      ['player_1_id', 'p-out'],
      ['player_2_id', 'p-x'],
    ]);
  });

  it('writes nothing when the match has games', async () => {
    queue('games', { count: 2, error: null });

    expect(await repairScheduledMatchPairing('m1', expected, next)).toBe('has_games');
    expect(queriesOn('matches')).toHaveLength(0);
  });

  it('reports a match no longer as planned (no row updated) as changed', async () => {
    queue('games', { count: 0, error: null });
    queue('matches', { data: [], error: null });

    expect(await repairScheduledMatchPairing('m1', expected, next)).toBe('changed');
  });
});

describe('handOverGroupRow', () => {
  const groups = { data: [{ id: 'g1', name: 'Group A', group_number: 1 }, { id: 'g2', name: 'Group B', group_number: 2 }], error: null };

  it('moves the planned row with one conditional UPDATE and reports the rows the target holds after it', async () => {
    queue('tournament_groups', groups, groups);
    queue('tournament_group_members',
      { data: [], error: null },
      { data: [{ group_id: 'g1' }], error: null },
      { data: [{ group_id: 'g1', player_id: 'p-in', seed: 1 }], error: null },
    );

    const outcome = await handOverGroupRow('t1', 'g1', 'p-out', 'p-in');

    expect(outcome).toEqual({ written: true, held_group_ids: ['g1'] });
    const update = queriesOn('tournament_group_members').find((q) => callsOf(q, 'update').length > 0)!;
    expect(callsOf(update, 'update')).toEqual([[{ player_id: 'p-in' }]]);
    expect(callsOf(update, 'eq')).toEqual([
      ['group_id', 'g1'],
      ['player_id', 'p-out'],
    ]);
    expect(queriesOn('tournament_group_members').some((q) => callsOf(q, 'delete').length > 0)).toBe(false);
  });

  it('still reports the move as written when the read after the UPDATE fails', async () => {
    // The row has moved; throwing here would leave the handover out of the
    // repair audit, and a re-run no longer plans it.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    queue('tournament_groups', groups, { data: null, error: { message: 'connection reset' } });
    queue('tournament_group_members',
      { data: [], error: null },
      { data: [{ group_id: 'g1' }], error: null },
    );

    const outcome = await handOverGroupRow('t1', 'g1', 'p-out', 'p-in');

    expect(outcome).toEqual({ written: true, held_group_ids: ['g1'] });
    expect(consoleError).toHaveBeenCalledWith(
      '[handOverGroupRow] Read after the handover failed:',
      { message: 'connection reset' },
    );
    consoleError.mockRestore();
  });

  it('writes nothing when the target already holds a row in the phase', async () => {
    queue('tournament_groups', groups);
    queue('tournament_group_members', { data: [{ group_id: 'g2', player_id: 'p-in', seed: 3 }], error: null });

    const outcome = await handOverGroupRow('t1', 'g1', 'p-out', 'p-in');

    expect(outcome).toEqual({ written: false, reason: 'target_grouped', held_group_ids: ['g2'] });
    expect(queriesOn('tournament_group_members').some((q) => callsOf(q, 'update').length > 0)).toBe(false);
  });

  it('writes nothing when the departed player no longer holds the row', async () => {
    queue('tournament_groups', groups);
    queue('tournament_group_members', { data: [], error: null }, { data: [], error: null });

    expect(await handOverGroupRow('t1', 'g1', 'p-out', 'p-in')).toEqual({ written: false, reason: 'row_gone' });
  });

  it('maps a primary-key clash (target placed in that group meanwhile) to target_grouped', async () => {
    queue('tournament_groups', groups);
    queue('tournament_group_members', { data: [], error: null }, { data: null, error: { code: '23505' } });

    expect(await handOverGroupRow('t1', 'g1', 'p-out', 'p-in')).toEqual({
      written: false,
      reason: 'target_grouped',
      held_group_ids: ['g1'],
    });
  });
});

describe('swapSeasonParticipant', () => {
  it('maps zero updated rows to 409 ROSTER_CHANGED', async () => {
    queue('season_participants', { data: [], error: null });

    const run = swapSeasonParticipant('s1', 'p-out', 'p-in');

    await expect(run).rejects.toBeInstanceOf(UserFacingError);
    await expect(run).rejects.toMatchObject({ code: 'ROSTER_CHANGED', statusCode: 409 });
  });

  it('maps a primary-key clash to 409 IN_ALREADY_ON_ROSTER', async () => {
    queue('season_participants', { data: null, error: { code: '23505', message: 'duplicate key' } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(swapSeasonParticipant('s1', 'p-out', 'p-in')).rejects.toMatchObject({
      code: 'IN_ALREADY_ON_ROSTER',
      statusCode: 409,
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rethrows any other error as it is', async () => {
    const dbError = { code: '57014', message: 'timeout' };
    queue('season_participants', { data: null, error: dbError });

    await expect(swapSeasonParticipant('s1', 'p-out', 'p-in')).rejects.toBe(dbError);
  });
});
