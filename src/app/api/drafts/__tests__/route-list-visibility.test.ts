import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SessionPlayer } from '@/types/auth';

/**
 * Who may read `GET /api/drafts`. The real route handler and the real `listDraftPools` query run against a
 * mocked Supabase client (not a mocked query module).
 *
 * Without a `season_id` the route lists every pool of every league, archived and test leagues included, with
 * season names and participant counts. Nothing in the app calls that list over HTTP (the creator content page reads
 * the query directly behind its own guard) and the docs file it under the admin routes, so it is site-admin only.
 * `GET /api/drafts?season_id=` stays open to any signed-in player: it serves one league's own pool summaries, the
 * same access model as `GET /api/drafts/[id]` and the draft board.
 */

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
    'contains', 'filter', 'not', 'or', 'order', 'limit', 'range', 'match',
    'returns', 'throwOnError',
  ]) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

// The guards behave like the real ones (src/lib/auth/helpers.ts): requirePlayer needs a session, requireAdmin a site admin.
vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  const session: { player: SessionPlayer | null } = { player: null };
  const requirePlayer = vi.fn(async () => {
    if (!session.player) throw new AuthError('Not authenticated', 401);
    return session.player;
  });
  return {
    AuthError,
    __session: session,
    requirePlayer,
    requireAdmin: vi.fn(async () => {
      const player = await requirePlayer();
      if (!player.isAdmin) throw new AuthError('Admin access required', 403);
      return player;
    }),
    requireAnyAdmin: vi.fn(),
    requireResourceAdmin: vi.fn(),
  };
});

vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/player-pool', () => ({ getInitialPoolForPlayer: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/drafts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/queries/drafts')>('@/lib/supabase/queries/drafts');
  return { ...actual, getDraftPoolsBySeason: vi.fn(async () => []) };
});

import { GET } from '@/app/api/drafts/route';
import * as helpers from '@/lib/auth/helpers';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';

const session = (helpers as unknown as { __session: { player: SessionPlayer | null } }).__session;

function sessionPlayer(overrides: Partial<SessionPlayer>): SessionPlayer {
  return {
    playerId: 'player-1',
    name: 'Player',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  };
}

const outsider = sessionPlayer({ playerId: 'player-outsider', name: 'Outsider' });
const resourceAdmin = sessionPlayer({ playerId: 'player-resource-admin', name: 'League admin', isResourceAdmin: true });
const siteAdmin = sessionPlayer({ playerId: 'admin-1', name: 'Admin', isAdmin: true });

/** A full `draft_pools` row as PostgREST returns it (every column `toDraftPool` reads). */
function poolRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pool-1',
    season_id: 'season-1',
    draft_type: 'snake',
    pick_order: 'snake',
    point_budget: null,
    pool_mode: 'tier',
    default_point_cost: null,
    team_size_mode: null,
    team_size_exact: null,
    team_size_min: null,
    team_size_max: null,
    status: 'pending',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    engine: 'legacy',
    kind: 'initial',
    mode: 'live',
    phase: 'setup',
    list_version_id: null,
    parent_pool_id: null,
    roster_size: null,
    pick_seconds: null,
    makeup_seconds: null,
    slow_ladder_seconds: null,
    extension_seconds: null,
    extensions_enabled: false,
    redraft_max_lines: null,
    redraft_lock_no_redraft_lines: false,
    submission_deadline_at: null,
    submissions_published_at: null,
    token_purchase_closes_at: null,
    paused_at: null,
    paused_by: null,
    pause_reason: null,
    state_version: 0,
    publish_notified_at: null,
    started_at: null,
    ended_at: null,
    created_by: 'player-admin',
    season_group_id: null,
    ...overrides,
  };
}


function request(query = '') {
  return { url: `http://localhost:3000/api/drafts${query}` } as unknown as NextRequest;
}

/** Three pools across three leagues: active, archived and test. The query applies no filter, so all come back. */
function queueThreeLeagues() {
  mockBuilder.order.mockReturnValueOnce({
    data: [
      { ...poolRow({ id: 'pool-active', season_id: 'season-active' }), seasons: { name: 'Active League' }, draft_picks: [{ id: 'pk-1' }, { id: 'pk-2' }] },
      { ...poolRow({ id: 'pool-archived', season_id: 'season-archived', status: 'complete', phase: 'complete' }), seasons: { name: 'Archived League' }, draft_picks: [] },
      { ...poolRow({ id: 'pool-test', season_id: 'season-test', engine: 'queue', kind: 'redraft', phase: 'submissions' }), seasons: { name: 'Test League' }, draft_picks: [{ id: 'pk-3' }] },
    ],
    error: null,
  });
  mockBuilder.in.mockReturnValueOnce({
    data: [
      { season_id: 'season-active' }, { season_id: 'season-active' },
      { season_id: 'season-archived' },
      { season_id: 'season-test' }, { season_id: 'season-test' }, { season_id: 'season-test' },
    ],
    error: null,
  });
}

describe('GET /api/drafts without a season', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.player = null;
    for (const m of Object.keys(mockBuilder)) {
      if (m !== 'single' && m !== 'maybeSingle') mockBuilder[m].mockReturnValue(mockBuilder);
    }
  });

  it('answers 401 before any read when there is no session', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it.each([
    ['a signed-in non-participant', outsider],
    ['a resource admin of one league', resourceAdmin],
  ])('answers 403 to %s and reads nothing, so no league is enumerated', async (_label, player) => {
    session.player = player;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('League');
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('serves every pool of every league to a site admin, with counts and no picks or private columns', async () => {
    session.player = siteAdmin;
    queueThreeLeagues();

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(['pool-active', 'pool-archived', 'pool-test']);
    expect(body.data.map((p: { participant_count: number }) => p.participant_count)).toEqual([2, 1, 3]);
    expect(body.data.map((p: { pick_count: number }) => p.pick_count)).toEqual([2, 0, 1]);
    expect(mockBuilder.from).toHaveBeenCalledWith('draft_pools');
    expect(mockBuilder.from).toHaveBeenCalledWith('season_participants');
    for (const pool of body.data) {
      expect(pool).not.toHaveProperty('draft_picks');
      expect(pool).not.toHaveProperty('submissions');
      expect(pool).not.toHaveProperty('discord_id');
    }
  });

  it('answers an empty list when no pool exists', async () => {
    session.player = siteAdmin;
    mockBuilder.order.mockReturnValueOnce({ data: [], error: null });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
    expect(mockBuilder.in).not.toHaveBeenCalled();
  });

  it('answers 500 with the safe fallback when the query fails', async () => {
    session.player = siteAdmin;
    mockBuilder.order.mockReturnValueOnce({ data: null, error: new Error('db down') });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to fetch draft pools');
  });
});

describe('GET /api/drafts?season_id= (stays open to signed-in players)', () => {
  const SEASON = '5eaf0000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    session.player = null;
  });

  it('serves a non-admin player the league\'s pool summaries', async () => {
    session.player = outsider;
    const pools = [{ id: 'pool-1', engine: 'queue', kind: 'initial', phase: 'setup', mode: 'live', status: 'pending' }] as const;
    vi.mocked(getDraftPoolsBySeason).mockResolvedValueOnce([...pools]);

    const response = await GET(request(`?season_id=${SEASON}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pools).toEqual(pools);
    expect(getDraftPoolsBySeason).toHaveBeenCalledWith(SEASON);
  });

  it('still requires a session', async () => {
    const response = await GET(request(`?season_id=${SEASON}`));

    expect(response.status).toBe(401);
    expect(getDraftPoolsBySeason).not.toHaveBeenCalled();
  });
});
