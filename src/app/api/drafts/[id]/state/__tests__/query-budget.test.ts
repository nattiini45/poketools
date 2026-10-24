/**
 * Query budget for GET /api/drafts/[id]/state (DATA-PLAN fix 2, §4.2).
 *
 * The real query modules, draft engine and progress engine run against a
 * counting fake of the service-role client: every `supabase.from()` and
 * `supabase.rpc()` is one PostgREST request. Auth is mocked (seat B owns the
 * auth queries). Before the batching, a 12-player completed EPB pool cost
 * about 66 queries per poll; the budget is now ≤ 12.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Counting fake of the Supabase client ──────────────────────────

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as string[],
  /** What each RPC answers (B-SNAP queue cases); null when unset. */
  rpcResults: {} as Record<string, unknown>,
  rpcArgs: [] as [string, unknown][],
}));

// A queue pool's tick may publish a redraft: the route expires the draft reads.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let single = false;
    const run = () => {
      const rows = (db.tables[table] ?? []).filter((row) =>
        filters.every(([column, value]) => !(column in row) || row[column] === value),
      );
      if (single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      is: () => chain,
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        single = true;
        return chain;
      },
      single: () => {
        single = true;
        return chain;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  }

  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(table);
        return builder(table);
      },
      rpc: (fn: string, args: unknown) => {
        db.calls.push(`rpc:${fn}`);
        db.rpcArgs.push([fn, args]);
        return Promise.resolve({ data: db.rpcResults[fn] ?? null, error: null });
      },
    },
  };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(async () => ({ playerId: 'p01', isAdmin: false })),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────

import { GET } from '@/app/api/drafts/[id]/state/route';
import { computeRemainingPoints, hasAllocatedDraftTokens } from '@/lib/draft/progress-engine';
import { computeDraftTokens } from '@/lib/draft/point-buy-engine';
import { revalidateTag } from 'next/cache';
import { expectNoPrivatePlayerData, PRIVATE_SENTINELS } from '@/lib/players/__tests__/private-player-fields';

// ─── Fixture: 12-player EPB season, pool complete ──────────────────

const SEASON = 'season-1';
const POOL = '11111111-1111-4111-8111-111111111111';
const PLAYERS = Array.from({ length: 12 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
const LINES = ['Eevee', 'Gastly', 'Dratini', 'Larvitar', 'Beldum', 'Gible', 'Axew', 'Deino', 'Jangmo-o'];
const RULES = { draft_budget: 100, draft_picks: 6, draft_token_ratio: 5, draft_token_max: 1 };

function playerRow(id: string): Row {
  return {
    id,
    name: `Trainer ${id}`,
    discord_id: `discord-${id}`,
    auth_user_id: `auth-${id}`,
    ps_username: null,
    champions_username: null,
    is_admin: id === 'p01',
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: '2026-01-01',
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: 'private note',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function seedCompletedEpbSeason(poolStatus: 'complete' | 'in_progress' = 'complete') {
  const picks: Row[] = [];
  let pickNumber = 1;
  for (let round = 1; round <= RULES.draft_picks; round++) {
    for (const [index, playerId] of PLAYERS.entries()) {
      picks.push({
        id: `pick-${pickNumber}`,
        draft_pool_id: POOL,
        player_id: playerId,
        pokemon_name: `${LINES[round - 1]}-${playerId}`,
        pick_number: pickNumber,
        round,
        // 5 × 15 + (20..25): 0-5 points left before grants and redrafts, so
        // purchasable tokens differ per player (0 and 1 both occur).
        points_spent: round < RULES.draft_picks ? 15 : 20 + (index % 6),
        timestamp: '2026-02-01T00:00:00Z',
        players: { name: `Trainer ${playerId}` },
      });
      pickNumber += 1;
    }
  }

  db.tables = {
    draft_pools: [
      {
        id: POOL,
        season_id: SEASON,
        draft_type: 'snake',
        point_budget: 100,
        pool_mode: 'point_buy',
        default_point_cost: 1,
        team_size_mode: null,
        team_size_exact: null,
        team_size_min: null,
        team_size_max: null,
        status: poolStatus,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
    draft_picks: picks,
    season_participants: PLAYERS.map((id) => ({
      season_id: SEASON,
      player_id: id,
      gym_type: null,
      core_types: null,
      core_assigned_at: null,
      players: playerRow(id),
    })),
    seasons: [
      {
        id: SEASON,
        name: 'Evo Liga',
        description: '',
        format_type: 'evolution_point_buy',
        ruleset_id: null,
        start_date: null,
        end_date: null,
        status: 'active',
        archived: false,
        legacy: false,
        is_test_season: false,
        core_pool: null,
        point_buy_list_id: 'list-1',
        route_theme: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
    format_rules: [
      {
        id: 'rules-1',
        season_id: SEASON,
        banned_moves: [],
        banned_items: [],
        tera_rules: null,
        tiebreaker_order: [],
        ...RULES,
        draft_token_max_per_line: null,
        redraft_phase_open: false,
        created_at: '2026-01-01',
      },
    ],
    evolution_tracker: PLAYERS.flatMap((playerId) =>
      LINES.map((base) => ({
        id: `t-${playerId}-${base}`,
        season_id: SEASON,
        player_id: playerId,
        base_pokemon: base,
        current_form: base,
        total_kos: 0,
        current_stage: 1,
        evolved_at: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        real_kills: 0,
        draft_tokens: 0,
        kill_tokens: 0,
        cosmo_points: 0,
        suspended_until_matchday: null,
        evolution_points_awarded: 0,
        locked_stage3_pokemon: null,
      })),
    ),
    evolution_tiers: LINES.map((base) => ({
      id: `tier-${base}`,
      season_id: SEASON,
      player_id: null,
      base_pokemon: base,
      stage2_pokemon: `${base}-2`,
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: 'B',
      created_at: '2026-01-01',
    })),
    epb_token_grants: [
      { season_id: SEASON, player_id: 'p02', grant_type: 'draft_token', token_count: 1, created_by: null, created_at: '2026-02-02' },
      { season_id: SEASON, player_id: 'p05', grant_type: 'draft_token', token_count: 2, created_by: null, created_at: '2026-02-02' },
    ],
    redraft_history: [
      { id: 'r1', season_id: SEASON, player_id: 'p03', from_tracker_id: null, to_base_pokemon: 'Gible', to_stage3_pokemon: null, transfer_type: 'free_swap', trade_partner_id: null, missing_kills_transferred: 0, points_spent: 4, created_at: '2026-03-02' },
      { id: 'r2', season_id: SEASON, player_id: 'p05', from_tracker_id: null, to_base_pokemon: 'Axew', to_stage3_pokemon: null, transfer_type: 'trade', trade_partner_id: 'p06', missing_kills_transferred: 1, points_spent: 2, created_at: '2026-03-03' },
    ],
  };
}

const routeParams = () => ({ params: Promise.resolve({ id: POOL }) });
const request = (query = '') => new NextRequest(`http://localhost/api/drafts/${POOL}/state${query}`);

beforeEach(() => {
  db.calls = [];
  db.rpcResults = {};
  db.rpcArgs = [];
  vi.mocked(revalidateTag).mockClear();
  seedCompletedEpbSeason();
});

// ─── Tests ─────────────────────────────────────────────────────────

describe('GET /api/drafts/[id]/state — query budget (P = 12, EPB)', () => {
  it('a completed pool with trackers issues at most 12 Supabase queries', async () => {
    const res = await GET(request('?include=trackers'), routeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(db.calls.length).toBeLessThanOrEqual(12);
    // One read per source; nothing is repeated per participant.
    const perTable = db.calls.reduce<Record<string, number>>((acc, table) => {
      acc[table] = (acc[table] ?? 0) + 1;
      return acc;
    }, {});
    for (const [table, count] of Object.entries(perTable)) {
      expect({ table, count }).toEqual({ table, count: 1 });
    }
    // 11 today: pool, picks, participants, season, rules, trackers, tiers,
    // draft-token grants, redraft history, and (B-PROG's season ledger, §7.3)
    // Draft Kill Token purchases and redraft refunds.
    expect(Object.keys(perTable).sort()).toEqual([
      'draft_picks',
      'draft_pools',
      'epb_draft_token_purchases',
      'epb_token_grants',
      'evolution_tiers',
      'evolution_tracker',
      'format_rules',
      'redraft_history',
      'redraft_slots',
      'season_participants',
      'seasons',
    ]);
    expect(Object.keys(json.data.evolution.trackers_by_player)).toHaveLength(12);
  });

  it('a completed pool without trackers stays within budget too', async () => {
    const res = await GET(request(), routeParams());

    expect(res.status).toBe(200);
    expect(db.calls.length).toBeLessThanOrEqual(12);
    expect(db.calls).not.toContain('evolution_tiers');
  });

  it('a live pool skips the token ledger entirely', async () => {
    seedCompletedEpbSeason('in_progress');

    const res = await GET(request(), routeParams());

    expect(res.status).toBe(200);
    expect(db.calls).not.toContain('epb_token_grants');
    expect(db.calls).not.toContain('redraft_history');
  });

  it('token and budget outputs equal the per-player functions on the same data', async () => {
    const res = await GET(request('?include=trackers'), routeParams());
    const { epb } = (await res.json()).data;

    db.calls = [];
    for (const playerId of PLAYERS) {
      const remaining = await computeRemainingPoints(SEASON, playerId, RULES.draft_budget, RULES.draft_token_ratio);
      expect({ playerId, tokens: epb.purchasable_tokens_by_player[playerId] }).toEqual({
        playerId,
        tokens: computeDraftTokens(remaining, RULES.draft_token_ratio, RULES.draft_token_max),
      });
      expect({ playerId, allocated: epb.tokens_allocated_by_player[playerId] }).toEqual({
        playerId,
        allocated: await hasAllocatedDraftTokens(SEASON, playerId),
      });
      expect(epb.picks_by_player[playerId]).toBe(RULES.draft_picks);
    }
    // The per-player path this replaces: 7 reads per participant (B-PROG's
    // ledger added token purchases and redraft refunds).
    expect(db.calls.length).toBe(PLAYERS.length * 7);

    // Spot checks that the fixture exercises every term of the formula.
    expect(epb.tokens_allocated_by_player.p02).toBe(true);
    expect(epb.tokens_allocated_by_player.p07).toBe(false); // no grant
    expect(new Set(Object.values(epb.purchasable_tokens_by_player))).toEqual(new Set([0, 1]));
  });

  it('the payload carries no player PII', async () => {
    const res = await GET(request('?include=trackers'), routeParams());
    const body = await res.text();

    for (const field of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_admin', 'is_test_account']) {
      expect(body).not.toContain(`"${field}"`);
    }
    expect(body).not.toContain('discord-p01');
    expect(body).not.toContain('private note');
  });
});

// ─── Queue-engine pools ────────────────────────────────────────────

/** A raw `draft_snapshot` answer whose participant row (wrongly) carries private player columns. */
function rawQueueSnapshot(publishedNow = false): Record<string, unknown> {
  return {
    state_version: 7,
    server_now: '2026-10-11T12:00:00Z',
    pool: {
      id: POOL, season_id: SEASON, kind: 'initial', mode: 'live', status: 'in_progress', paused: false,
      paused_at: null, roster_size: 6, budget: 100, started_at: '2026-10-11T11:00:00Z', ended_at: null,
      phase: 'drafting', pause_reason: null, list_version_id: 'list-1', engine: 'queue',
    },
    config: { pick_seconds: 300, makeup_seconds: 150, slow_ladder_seconds: [43200], extension_seconds: [120, 60], redraft_max_lines: 3 },
    participants: [
      {
        player_id: 'p01', name: 'Trainer p01', avatar_url: null, seat: 1, standing_rank: null, slots_total: 6,
        picks_made: 0, open_slots: 6, budget_start: 100, budget_remaining: 100, penalty_stage: 0, timeout_count: 0,
        extensions: { plus120_used: false, plus60_used: false }, done: false,
        discord_id: PRIVATE_SENTINELS.discord_id, ban_reason: PRIVATE_SENTINELS.ban_reason,
      },
    ],
    active_slot: null,
    upcoming: [],
    picks: [],
    taken: {},
    prices: { 'eevee--sylveon': 20 },
    restrictions: [],
    no_redraft_line_ids: [],
    redraft: null,
    recent_events: [],
    published_now: publishedNow,
  };
}

function seedQueuePool() {
  db.tables.draft_pools = [{ ...db.tables.draft_pools[0], engine: 'queue', kind: 'initial', phase: 'drafting' }];
}

describe('GET /api/drafts/[id]/state — queue engine', () => {
  it('a queue pool issues exactly the pool read and one draft_snapshot RPC', async () => {
    seedQueuePool();
    db.rpcResults.draft_snapshot = rawQueueSnapshot();

    const res = await GET(request('?include=trackers'), routeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(db.calls).toEqual(['draft_pools', 'rpc:draft_snapshot']);
    expect(db.rpcArgs).toEqual([['draft_snapshot', { p_pool_id: POOL, p_since: null, p_tick: true }]]);
    expect(json.data.state_version).toBe(7);
    expect(json.data.viewer.player_id).toBe('p01');
    expect(revalidateTag).not.toHaveBeenCalled();
    // `status` here is the pool's status, not a player column.
    expectNoPrivatePlayerData(json, { allowKeys: ['status'] });
  });

  it('?since=<current> costs the same two calls and answers unchanged', async () => {
    seedQueuePool();
    db.rpcResults.draft_snapshot = { unchanged: true, state_version: 7, server_now: '2026-10-11T12:00:00Z', published_now: false };

    const res = await GET(request('?since=7'), routeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(db.calls).toEqual(['draft_pools', 'rpc:draft_snapshot']);
    expect(db.rpcArgs[0]).toEqual(['draft_snapshot', { p_pool_id: POOL, p_since: 7, p_tick: true }]);
    expect(json).toEqual({ success: true, data: { unchanged: true, state_version: 7, server_now: '2026-10-11T12:00:00Z' } });
  });

  it('a redraft published by this tick expires the league draft reads', async () => {
    seedQueuePool();
    db.rpcResults.draft_snapshot = rawQueueSnapshot(true);

    const res = await GET(request(), routeParams());

    expect(res.status).toBe(200);
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([[`season:${SEASON}`, { expire: 0 }]]);
    expect(await res.text()).not.toContain('published_now');
  });

  it('a malformed since answers 400 validation_failed without an RPC', async () => {
    seedQueuePool();

    const res = await GET(request('?since=abc'), routeParams());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(db.calls).toEqual(['draft_pools']);
  });
});
