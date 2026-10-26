/**
 * The recycle-bin queries: the RPC names and arguments (the retention window is the one constant), the typed answers,
 * database signals as `LeagueTrashDbError`, a list read that never touches the captured rows, and the rebuild markers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];
interface Call {
  table: string;
  steps: Step[];
}

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  rpcCalls: [] as { name: string; args: unknown }[],
  respond: null as null | ((call: { table: string; steps: [string, ...unknown[]][] }) => {
    data?: unknown;
    count?: number | null;
    error?: unknown;
  }),
  rpcReply: null as null | { data?: unknown; error?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, steps: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'order', 'limit']) {
      chain[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        return chain;
      };
    }
    const reply = () => state.respond?.(call) ?? { data: [], count: 0, error: null };
    chain.maybeSingle = () => Promise.resolve().then(() => ({ error: null, ...reply() }));
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null, ...reply() });
    return chain;
  }
  return {
    supabase: {
      from: builder,
      rpc: (name: string, args: unknown) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve({ error: null, ...(state.rpcReply ?? { data: {} }) });
      },
    },
  };
});

import { LEAGUE_TRASH_EXPIRE_BATCH, LEAGUE_TRASH_LIST_LIMIT, LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import { LeagueTrashDbError } from '@/lib/league-trash/db-error';
import {
  countLeagueTrashForPlayer,
  expireLeagueTrash,
  getLeagueTrashBySeason,
  getLeagueTrashSchemaVersion,
  listLeagueTrash,
  listPendingLeagueRebuilds,
  markLeagueRestoreRebuildDone,
  markLeagueTrashRebuildDone,
  moveLeagueToTrash,
  restoreLeagueFromTrash,
} from '../league-trash';

const SEASON = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const TRASH = '33333333-3333-4333-8333-333333333333';
const PHASE = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  state.calls = [];
  state.rpcCalls = [];
  state.respond = null;
  state.rpcReply = null;
});

describe('moveLeagueToTrash', () => {
  it('calls league_trash_delete with the retention constant and parses the answer', async () => {
    state.rpcReply = {
      data: {
        trash_id: TRASH,
        season_id: SEASON,
        season_name: 'Spring',
        deleted_at: '2026-10-26T10:00:00Z',
        purge_after: '2027-01-24T10:00:00Z',
        counts: { matches: 3, games: 5 },
        player_ids: [ACTOR],
        phase_ids: [PHASE],
        frozen_pools: 1,
        schema_version: '20261026091500',
      },
    };
    const result = await moveLeagueToTrash(SEASON, ACTOR);
    expect(state.rpcCalls).toEqual([
      { name: 'league_trash_delete', args: { p_season_id: SEASON, p_actor: ACTOR, p_retention_days: LEAGUE_TRASH_RETENTION_DAYS } },
    ]);
    expect(result).toEqual({
      trash_id: TRASH,
      season_id: SEASON,
      season_name: 'Spring',
      deleted_at: '2026-10-26T10:00:00Z',
      purge_after: '2027-01-24T10:00:00Z',
      counts: { matches: 3, games: 5 },
      player_ids: [ACTOR],
      phase_ids: [PHASE],
      frozen_pools: 1,
      schema_version: '20261026091500',
    });
  });

  it('throws the typed error for a catalogued exception and the raw error otherwise', async () => {
    state.rpcReply = { error: { code: 'P0001', message: 'LEAGUE_TRASH_SEASON_NOT_FOUND', details: null } };
    await expect(moveLeagueToTrash(SEASON, ACTOR)).rejects.toMatchObject({ name: 'LeagueTrashDbError', code: 'LEAGUE_TRASH_SEASON_NOT_FOUND' });

    const raw = { code: '42501', message: 'permission denied' };
    state.rpcReply = { error: raw };
    await expect(moveLeagueToTrash(SEASON, ACTOR)).rejects.toBe(raw);
  });

  it('rejects an answer of the wrong shape instead of passing it on', async () => {
    state.rpcReply = { data: [] };
    await expect(moveLeagueToTrash(SEASON, ACTOR)).rejects.toThrow(/unexpected shape/);
  });
});

describe('restoreLeagueFromTrash', () => {
  it('calls league_trash_restore (no clock argument) and parses counts, queue size and warnings', async () => {
    state.rpcReply = {
      data: {
        season_id: SEASON,
        season_name: 'Spring',
        restored: { matches: 3 },
        shift_seconds: 86400.5,
        player_ids: [ACTOR],
        phase_ids: [PHASE],
        paused_pools: 2,
        queued_aggregate_jobs: 5,
        schema_version_at_delete: null,
        warnings: [
          { code: 'parent_missing_nulled', rel: 'draft_picks', column: 'line_entry_id', count: 1 },
          { code: 'replay_hash_released', count: 2 },
          { code: 'columns_ignored', rel: 'format_rules', columns: ['lt_tmp'] },
          { code: 'something_new' },
        ],
      },
    };
    const result = await restoreLeagueFromTrash(TRASH);
    expect(state.rpcCalls).toEqual([{ name: 'league_trash_restore', args: { p_trash_id: TRASH } }]);
    expect(result.paused_pools).toBe(2);
    expect(result.queued_aggregate_jobs).toBe(5);
    expect(result.schema_version_at_delete).toBeNull();
    expect(result.warnings).toEqual([
      { code: 'parent_missing_nulled', rel: 'draft_picks', column: 'line_entry_id', count: 1 },
      { code: 'replay_hash_released', count: 2 },
      { code: 'columns_ignored', rel: 'format_rules', columns: ['lt_tmp'] },
    ]);
  });

  it('maps the restore signals', async () => {
    for (const code of ['LEAGUE_TRASH_EXPIRED', 'LEAGUE_TRASH_PLAN_MISMATCH', 'LEAGUE_TRASH_PARENT_MISSING'] as const) {
      state.rpcReply = { error: { code: 'P0001', message: code, details: JSON.stringify({ rel: 'matches' }) } };
      const error = await restoreLeagueFromTrash(TRASH).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LeagueTrashDbError);
      expect(error).toMatchObject({ code, detail: { rel: 'matches' } });
    }
  });
});

describe('expireLeagueTrash', () => {
  it('passes the clock and the batch size and returns the purged rows with their match ids', async () => {
    state.rpcReply = {
      data: [
        {
          id: TRASH,
          season_id: SEASON,
          season_name: 'Spring',
          deleted_at: '2026-01-01T00:00:00Z',
          purge_after: '2026-04-01T00:00:00Z',
          match_ids: ['m1', 'm2'],
        },
      ],
    };
    const now = new Date('2026-10-26T10:00:00Z');
    const rows = await expireLeagueTrash(now);
    expect(state.rpcCalls).toEqual([
      { name: 'league_trash_expire', args: { p_now: now.toISOString(), p_limit: LEAGUE_TRASH_EXPIRE_BATCH } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].match_ids).toEqual(['m1', 'm2']);
  });

  it('rejects a non-array answer', async () => {
    state.rpcReply = { data: {} };
    await expect(expireLeagueTrash()).rejects.toThrow(/unexpected shape/);
  });
});

describe('listLeagueTrash', () => {
  it('names its columns, orders newest first, is bounded and never selects the captured rows', async () => {
    state.respond = () => ({
      data: [
        {
          id: TRASH,
          season_id: SEASON,
          season_name: 'Spring',
          format_type: 'singles',
          deleted_at: '2026-10-26T10:00:00Z',
          deleted_by: ACTOR,
          deleted_by_name: 'Admin',
          purge_after: '2027-01-24T10:00:00Z',
          counts: { matches: 3, bad: 'x' },
          rebuild_pending: false,
          schema_version: null,
        },
      ],
    });
    const items = await listLeagueTrash();
    expect(items[0].counts).toEqual({ matches: 3 });
    const [call] = state.calls;
    expect(call.table).toBe('league_trash');
    const select = call.steps.find((s) => s[0] === 'select');
    expect(select?.[1]).not.toMatch(/snapshot|rows|unlinked|\*/);
    expect(select?.[1]).toContain('rebuild_pending');
    expect(call.steps).toContainEqual(['order', 'deleted_at', { ascending: false }]);
    expect(call.steps).toContainEqual(['limit', LEAGUE_TRASH_LIST_LIMIT]);
    expect(state.calls.every((c) => c.table !== 'league_trash_tables')).toBe(true);
  });

  it('throws a read error', async () => {
    const boom = { message: 'down' };
    state.respond = () => ({ error: boom });
    await expect(listLeagueTrash()).rejects.toBe(boom);
  });
});

describe('getLeagueTrashBySeason / countLeagueTrashForPlayer', () => {
  it('reads the trash entry of a league', async () => {
    state.respond = () => ({ data: { id: TRASH, purge_after: 'x' } });
    await expect(getLeagueTrashBySeason(SEASON)).resolves.toEqual({ id: TRASH, purge_after: 'x' });
    expect(state.calls[0].steps).toContainEqual(['eq', 'season_id', SEASON]);
  });

  it('does not query for an id that is not a uuid', async () => {
    await expect(getLeagueTrashBySeason('nope')).resolves.toBeNull();
    await expect(countLeagueTrashForPlayer('nope')).resolves.toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it('counts a player in the junction table with a head count', async () => {
    state.respond = () => ({ count: 2 });
    await expect(countLeagueTrashForPlayer(ACTOR)).resolves.toBe(2);
    const [call] = state.calls;
    expect(call.table).toBe('league_trash_players');
    expect(call.steps).toContainEqual(['select', 'trash_id', { count: 'exact', head: true }]);
    expect(call.steps).toContainEqual(['eq', 'player_id', ACTOR]);
  });
});

describe('rebuild markers', () => {
  it('lists the pending rebuilds of both kinds', async () => {
    state.respond = (call) =>
      call.table === 'league_trash'
        ? { data: [{ id: TRASH, season_id: SEASON, season_name: 'A', deleted_at: 'd', phase_ids: [PHASE], player_ids: [ACTOR] }] }
        : { data: [{ trash_id: TRASH, season_id: SEASON, season_name: 'B', restored_at: 'r', phase_ids: [], player_ids: [] }] };
    const pending = await listPendingLeagueRebuilds();
    expect(pending.map((p) => [p.kind, p.season_name, p.at])).toEqual([
      ['delete', 'A', 'd'],
      ['restore', 'B', 'r'],
    ]);
    expect(state.calls.find((c) => c.table === 'league_trash')?.steps).toContainEqual(['eq', 'rebuild_pending', true]);
  });

  it('confirms a rebuild through the two functions', async () => {
    state.rpcReply = { data: true };
    await expect(markLeagueTrashRebuildDone(TRASH)).resolves.toBe(true);
    await expect(markLeagueRestoreRebuildDone(SEASON)).resolves.toBe(true);
    state.rpcReply = { data: false };
    await expect(markLeagueTrashRebuildDone(TRASH)).resolves.toBe(false);
    expect(state.rpcCalls.map((c) => c.name)).toEqual([
      'league_trash_rebuild_done',
      'league_trash_restore_rebuild_done',
      'league_trash_rebuild_done',
    ]);
  });

  it('reads the schema version', async () => {
    state.rpcReply = { data: '20261026091500' };
    await expect(getLeagueTrashSchemaVersion()).resolves.toBe('20261026091500');
    state.rpcReply = { data: null };
    await expect(getLeagueTrashSchemaVersion()).resolves.toBeNull();
  });
});
