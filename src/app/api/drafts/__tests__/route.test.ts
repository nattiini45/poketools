import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { DraftPool, DraftPoolWithDetails } from '@/types/draft';
import type { SessionPlayer } from '@/types/auth';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireResourceAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(async () => ({ playerId: 'admin-1', isAdmin: true })),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  listDraftPools: vi.fn(),
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolBySeasonGroup: vi.fn(),
  getDraftPoolsBySeason: vi.fn(async () => []),
  createDraftPool: vi.fn(),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));

// League groups: a league without groups (the default here) has none.
vi.mock('@/lib/supabase/queries/season-groups', () => ({
  getSeasonGroups: vi.fn(async () => []),
  getSeasonGroupOfPlayer: vi.fn(async () => null),
}));

// EPB pool-budget default reads the season format + format rules; non-EPB
// seasons (the default here) leave the request body untouched.
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => ({ id: 'season-1', format_type: 'draft' })),
  getSeasonParticipants: vi.fn(async () => []),
}));

// Queue-engine creation (EPB seasons).
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/season/epb-phase', () => ({ getEpbPhaseStatus: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn(async () => []) }));
vi.mock('@/lib/tournament/season-standings', () => ({ computeStandingsForSeason: vi.fn() }));
vi.mock('@/lib/tournament/group-first-half', () => ({ getGroupFirstHalfTables: vi.fn(async () => null) }));
// A fixed "draw": the roster reversed, so a passing test proves the seats come from the draw, not the database order.
vi.mock('@/lib/draft/seat-draw', () => ({ drawSeatOrder: vi.fn((ids: readonly string[]) => [...ids].reverse()) }));
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

// The pack's quiet window is a spy over the real accessor (the example pack has none); tests switch it per case.
vi.mock('@/lib/format-pack', async () => {
  const actual = await vi.importActual<typeof import('@/lib/format-pack')>('@/lib/format-pack');
  return { ...actual, draftQuietHours: vi.fn(actual.draftQuietHours) };
});

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(async () => null),
}));

import { GET, POST } from '@/app/api/drafts/route';
import { requirePlayer, requireResourceAdmin, requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import {
  listDraftPools,
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
  getDraftPoolsBySeason,
  createDraftPool,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { expireDraftReads } from '@/lib/revalidation';
import { getEpbPhaseStatus } from '@/lib/season/epb-phase';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getGroupFirstHalfTables } from '@/lib/tournament/group-first-half';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { drawSeatOrder } from '@/lib/draft/seat-draw';
import { draftQuietHours } from '@/lib/format-pack';
import { DraftRuleError } from '@/lib/draft/errors';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import { getSeasonGroupOfPlayer, getSeasonGroups } from '@/lib/supabase/queries/season-groups';

const mockPool: DraftPool = {
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
  slow_ladder_seconds: [],
  extension_seconds: [],
  extensions_enabled: true,
  redraft_max_lines: null,
  redraft_lock_no_redraft_lines: true,
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
  created_by: null,
};

const mockPoolWithDetails: DraftPoolWithDetails = {
  ...mockPool,
  season_name: 'Season One',
  participant_count: 0,
  pick_count: 0,
};

const player: SessionPlayer = {
  playerId: 'player-1',
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
} as const;

const adminPlayer: SessionPlayer = {
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
} as const;

describe('GET /api/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const url = new URL('http://localhost:3000/api/drafts');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('returns all draft pools when no season_id', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listDraftPools).mockResolvedValue([mockPoolWithDetails]);

    const url = new URL('http://localhost:3000/api/drafts');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockPoolWithDetails]);
    expect(vi.mocked(listDraftPools)).toHaveBeenCalledTimes(1);
  });

  it('returns draft pool for specific season', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(mockPool);

    const url = new URL('http://localhost:3000/api/drafts?season_id=5eaf0000-0000-4000-8000-000000000001');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockPool);
    expect(body.pools).toEqual([]);
    expect(vi.mocked(getDraftPoolBySeason)).toHaveBeenCalledWith('5eaf0000-0000-4000-8000-000000000001');
  });

  it('lists every pool of the season as pools, with its engine (route #2)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(mockPool);
    const pools = [
      { id: 'pool-1', engine: 'legacy', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
      { id: 'pool-2', engine: 'queue', kind: 'redraft', phase: 'submissions', mode: 'slow', status: 'in_progress' },
    ] as const;
    vi.mocked(getDraftPoolsBySeason).mockResolvedValue([...pools]);

    const url = new URL('http://localhost:3000/api/drafts?season_id=5eaf0000-0000-4000-8000-000000000001');
    const response = await GET({ url: url.toString() } as unknown as NextRequest);
    const body = await response.json();

    expect(body.pools).toEqual(pools);
    expect(vi.mocked(getDraftPoolsBySeason)).toHaveBeenCalledWith('5eaf0000-0000-4000-8000-000000000001');
  });

  it('returns null data when no pool for season', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);

    const url = new URL('http://localhost:3000/api/drafts?season_id=5eaf0000-0000-4000-8000-000000000002');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listDraftPools).mockRejectedValue(new Error('DB error'));

    const url = new URL('http://localhost:3000/api/drafts');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch draft pools');
  });
});

describe('POST /api/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers 401 to an unauthenticated POST with a malformed body (guard before parse)', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValueOnce(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Authentication required', 401),
    );
    const json = vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'));
    const response = await POST({ json } as unknown as NextRequest);
    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(requireResourceAdmin).not.toHaveBeenCalled();
  });

  it('answers 401, not 400, to an unauthenticated POST with an invalid body', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValueOnce(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Authentication required', 401),
    );
    const response = await POST({ json: vi.fn().mockResolvedValue({ nope: 1 }) } as unknown as NextRequest);
    expect(response.status).toBe(401);
  });

  it('returns 400 when season_id is missing', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ draft_type: 'snake' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('season_id');
  });

  it('returns 400 when draft_type is missing', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('draft_type');
  });

  it('returns 403 when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', '00000000-0000-4000-a000-000000000001');
  });

  it('returns 400 when auction draft missing point_budget', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'auction' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('point_budget is required for auction/budget drafts');
  });

  it('returns 400 when budget draft missing point_budget', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'budget' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('point_budget is required for auction/budget drafts');
  });

  it('returns 409 when season already has a draft pool', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(mockPool);

    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('This season already has a draft pool');
  });

  it('creates draft pool and returns 201', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(createDraftPool).mockResolvedValue(mockPool);

    const formData = { season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake' as const };
    const request = {
      json: vi.fn().mockResolvedValue(formData),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockPool);
    expect(vi.mocked(createDraftPool)).toHaveBeenCalledWith({
      season_id: formData.season_id,
      draft_type: formData.draft_type,
      // No pick_order sent: a snake pool keeps snake order.
      pick_order: 'snake',
      point_budget: null,
      default_point_cost: null,
    });
    // Kilo 4245127334: the cached `hasDraftPool` of the league page flips at once (D37).
    expect(vi.mocked(expireDraftReads)).toHaveBeenCalledWith(formData.season_id);
  });

  it('expires no draft reads when the legacy create fails or is refused', async () => {
    vi.mocked(expireDraftReads).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(mockPool);
    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake' }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(vi.mocked(expireDraftReads)).not.toHaveBeenCalled();
  });

  it('creates auction draft pool with point_budget', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    const auctionPool: DraftPool = { ...mockPool, draft_type: 'auction', point_budget: 100 };
    vi.mocked(createDraftPool).mockResolvedValue(auctionPool);

    const formData = { season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'auction' as const, budget: 100 };
    const request = {
      json: vi.fn().mockResolvedValue(formData),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(vi.mocked(createDraftPool)).toHaveBeenCalledWith({
      season_id: formData.season_id,
      draft_type: formData.draft_type,
      // No pick_order sent: an auction runs in free order, as before the split.
      pick_order: 'free',
      point_budget: 100,
      default_point_cost: null,
    });
  });

  it('creates a snake-order pool with fixed costs (pick_order and pricing are separate)', async () => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(createDraftPool).mockResolvedValue({ ...mockPool, draft_type: 'budget', pick_order: 'snake', point_budget: 120 });

    const formData = {
      season_id: '00000000-0000-4000-a000-000000000001',
      draft_type: 'budget' as const,
      pick_order: 'snake' as const,
      budget: 120,
    };
    const response = await POST({ json: vi.fn().mockResolvedValue(formData) } as unknown as NextRequest);

    expect(response.status).toBe(201);
    expect(vi.mocked(createDraftPool)).toHaveBeenCalledWith({
      season_id: formData.season_id,
      draft_type: 'budget',
      pick_order: 'snake',
      point_budget: 120,
      default_point_cost: null,
    });
  });

  it('keeps linear order for a pool without points', async () => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(createDraftPool).mockResolvedValue({ ...mockPool, pick_order: 'linear' });

    const formData = { season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake' as const, pick_order: 'linear' as const };
    const response = await POST({ json: vi.fn().mockResolvedValue(formData) } as unknown as NextRequest);

    expect(response.status).toBe(201);
    expect(vi.mocked(createDraftPool)).toHaveBeenCalledWith(expect.objectContaining({ draft_type: 'snake', pick_order: 'linear' }));
  });

  it.each(['snake', 'linear'] as const)('refuses an auction in %s order with draft_auction_order_not_free, before any write', async (order) => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(getDraftPoolBySeason).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        draft_type: 'auction',
        pick_order: order,
        budget: 100,
      }),
    } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: 'draft_auction_order_not_free',
      error: 'Auction drafts need free pick order: the winning bidder gets the pick',
    });
    expect(vi.mocked(createDraftPool)).not.toHaveBeenCalled();
  });

  it('refuses fixed costs in a turn order when the budget cannot fill the rounds at the default price', async () => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    const body = (pickOrder: string) => ({
      season_id: '00000000-0000-4000-a000-000000000001',
      draft_type: 'budget',
      pick_order: pickOrder,
      budget: 100,
      default_point_cost: 10,
    });

    const response = await POST({ json: vi.fn().mockResolvedValue(body('snake')) } as unknown as NextRequest);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      code: 'draft_budget_below_rounds',
      params: { budget: 100, rounds: 11, price: 10, minimum: 110 },
    });
    expect(vi.mocked(createDraftPool)).not.toHaveBeenCalled();

    // Free order has no turn to stall: the same pool is created as before.
    vi.mocked(createDraftPool).mockResolvedValue({ ...mockPool, draft_type: 'budget', pick_order: 'free' });
    const free = await POST({ json: vi.fn().mockResolvedValue(body('free')) } as unknown as NextRequest);
    expect(free.status).toBe(201);
  });

  it('rejects an unknown pick_order with validation_failed', async () => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);

    const response = await POST({
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake', pick_order: 'random' }),
    } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(vi.mocked(createDraftPool)).not.toHaveBeenCalled();
  });

  it('passes a budget pool default_point_cost through to createDraftPool', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(createDraftPool).mockResolvedValue({ ...mockPool, draft_type: 'budget', point_budget: 180, default_point_cost: 5 });

    const formData = { season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'budget' as const, budget: 180, default_point_cost: 5 };
    const response = await POST({ json: vi.fn().mockResolvedValue(formData) } as unknown as NextRequest);

    expect(response.status).toBe(201);
    expect(vi.mocked(createDraftPool)).toHaveBeenCalledWith({
      season_id: formData.season_id,
      draft_type: 'budget',
      pick_order: 'free',
      point_budget: 180,
      default_point_cost: 5,
    });
  });

  it.each([-1, 1.5, LEGACY_POINTS_MAX + 1, '5'])('rejects default_point_cost %s with 400 before any write', async (bad) => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        draft_type: 'budget',
        budget: 180,
        default_point_cost: bad,
      }),
    } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(createDraftPool).not.toHaveBeenCalled();
  });

  it('rejects a default_point_cost above the budget with 400 before any write', async () => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        draft_type: 'budget',
        budget: 180,
        default_point_cost: 181,
      }),
    } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params.issues).toContain('default_point_cost');
    expect(createDraftPool).not.toHaveBeenCalled();
  });

  it.each([
    ['auction', 100],
    ['snake', undefined],
  ] as const)('refuses a default_point_cost for draft_type %s with 400 before any write', async (draftType, budget) => {
    vi.mocked(createDraftPool).mockClear();
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        draft_type: draftType,
        budget,
        default_point_cost: 5,
      }),
    } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params.issues).toBe(`default_point_cost: only budget drafts take a default price (got draft_type ${draftType})`);
    expect(createDraftPool).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(createDraftPool).mockRejectedValue(new Error('DB error'));

    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001', draft_type: 'snake' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to create draft pool');
  });
});

describe('POST /api/drafts (queue engine, EPB seasons)', () => {
  const SEASON = '00000000-0000-4000-a000-000000000001';
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const post = (body: unknown) => POST({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON, format_type: 'evolution_point_buy' } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: A, name: 'Ash' }, { id: B, name: 'Brock' }] as never);
    vi.mocked(callDraftRpc).mockResolvedValue('new-pool');
  });

  it('creates an initial queue pool with frozen seats and expires the draft reads', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', config: { mode: 'slow', pick_seconds: 3600 } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ success: true, data: { pool_id: 'new-pool' } });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_create_pool', {
      p_season_id: SEASON,
      p_kind: 'initial',
      p_actor_id: 'admin-1',
      p_config: { mode: 'slow', pick_seconds: 3600, quiet_hours: null },
      p_seats: [{ player_id: B, seat: 1 }, { player_id: A, seat: 2 }],
    });
    expect(expireDraftReads).toHaveBeenCalledWith(SEASON);
    expect(createDraftPool).not.toHaveBeenCalled();
  });

  it('seats an initial pool by a random draw of the roster, not in database row order', async () => {
    await post({ season_id: SEASON, kind: 'initial' });
    expect(drawSeatOrder).toHaveBeenCalledWith([A, B]);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({
      p_seats: [{ player_id: B, seat: 1 }, { player_id: A, seat: 2 }],
    });
  });

  it('an admin order takes precedence over the draw', async () => {
    await post({ season_id: SEASON, kind: 'initial', config: { participant_order: [A, B] } });
    expect(drawSeatOrder).not.toHaveBeenCalled();
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({
      p_seats: [{ player_id: A, seat: 1 }, { player_id: B, seat: 2 }],
    });
  });

  it('a slow draft without a pick time gets the slow default (12 h), not the SQL default of 300 s', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', config: { mode: 'slow' } });
    expect(response.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({
      p_config: { mode: 'slow', pick_seconds: 43_200, quiet_hours: null },
    });
  });

  it('a live draft without a pick time leaves the default to the SQL (unchanged call)', async () => {
    await post({ season_id: SEASON, kind: 'initial', config: { mode: 'live' } });
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_config: { mode: 'live', quiet_hours: null } });
    expect((vi.mocked(callDraftRpc).mock.calls[0][1] as { p_config: object }).p_config).not.toHaveProperty('pick_seconds');
  });

  it('an explicit slow pick time is kept', async () => {
    await post({ season_id: SEASON, kind: 'initial', config: { mode: 'slow', pick_seconds: 7200 } });
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_config: { mode: 'slow', pick_seconds: 7200 } });
  });

  it('checks the clock the request names like the PATCH route: a make-up time above the (default) 300 s live pick is refused', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', config: { makeup_seconds: 400 } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'makeup_seconds' } });
    expect(callDraftRpc).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('refuses nothing the request does not name: a 100 s live pick leaves the make-up time to the SQL default', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', config: { pick_seconds: 100 } });
    expect(response.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_config: { pick_seconds: 100 } });
  });

  it('a Redraft line cap is not judged against a roster size the request omits (the season’s rules decide it)', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', config: { redraft_max_lines: 15 } });
    expect(response.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_config: { redraft_max_lines: 15 } });
  });

  it('uses participant_order as the seat order and keeps it out of the config', async () => {
    await post({ season_id: SEASON, kind: 'initial', config: { participant_order: [B, A] } });
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({
      p_config: {},
      p_seats: [{ player_id: B, seat: 1 }, { player_id: A, seat: 2 }],
    });
  });

  it('refuses an order that is not the season participant set', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', config: { participant_order: [A, C] } });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('SEATS_INVALID');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('turns a legacy-shaped body into an initial queue pool with its budget', async () => {
    const response = await post({ season_id: SEASON, draft_type: 'snake', budget: 200 });
    expect(response.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_kind: 'initial', p_config: { budget: 200 } });
  });

  it('refuses a default_point_cost in a legacy-shaped body instead of dropping it (400 validation_failed)', async () => {
    const response = await post({ season_id: SEASON, draft_type: 'budget', budget: 180, default_point_cost: 5 });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: 'validation_failed',
      params: { issues: 'default_point_cost: point-buy seasons price picks from the point-buy list' },
    });
    expect(callDraftRpc).not.toHaveBeenCalled();
    expect(createDraftPool).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('still accepts a legacy-shaped body without a default price (null counts as none)', async () => {
    const response = await post({ season_id: SEASON, draft_type: 'budget', budget: 180, default_point_cost: null });
    expect(response.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_config: { budget: 180 } });
  });

  it('refuses a redraft before the first half is complete (REDRAFT_NOT_YET_ALLOWED)', async () => {
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: 't1', hinrunde_round_numbers: [1, 2], hinrunde_complete: false,
    } as never);
    const response = await post({ season_id: SEASON, kind: 'redraft' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('REDRAFT_NOT_YET_ALLOWED');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('seats a redraft from first-half standings (last place first) with the default deadline', async () => {
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: 't1', hinrunde_round_numbers: [1], hinrunde_complete: true,
    } as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([
      { player_1_id: A, player_2_id: B, winner_id: A, round_number: 1 },
      { player_1_id: A, player_2_id: B, winner_id: B, round_number: 2 },
    ]);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([{ player_id: A }, { player_id: B }] as never);

    const response = await post({ season_id: SEASON, kind: 'redraft' });

    expect(response.status).toBe(201);
    // Only first-half (Hinrunde) matches count.
    expect(vi.mocked(computeStandingsForSeason).mock.calls[0][3]).toEqual([
      { player_1_id: A, player_2_id: B, winner_id: A, round_number: 1 },
    ]);
    const args = vi.mocked(callDraftRpc).mock.calls[0][1] as {
      p_seats: unknown;
      p_config: { submission_deadline_at: string };
    };
    expect(args.p_seats).toEqual([
      { player_id: B, seat: 1, standing_rank: 2 },
      { player_id: A, seat: 2, standing_rank: 1 },
    ]);
    expect(Date.parse(args.p_config.submission_deadline_at)).toBeGreaterThan(Date.now());
  });

  it('allows a forced early redraft', async () => {
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: null, hinrunde_round_numbers: [], hinrunde_complete: false,
    } as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([{ player_id: A }, { player_id: B }] as never);
    const response = await post({ season_id: SEASON, kind: 'redraft', force: true });
    expect(response.status).toBe(201);
  });

  it('sends the format pack quiet window as config.quiet_hours, for initial and redraft pools', async () => {
    const berlin = { startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' };
    vi.mocked(draftQuietHours).mockReturnValueOnce(berlin).mockReturnValueOnce(berlin);
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: null, hinrunde_round_numbers: [], hinrunde_complete: false,
    } as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([{ player_id: A }, { player_id: B }] as never);

    expect((await post({ season_id: SEASON, kind: 'initial' })).status).toBe(201);
    expect((await post({ season_id: SEASON, kind: 'redraft', force: true })).status).toBe(201);

    const quiet = { start_hour: 0, end_hour: 6, time_zone: 'Europe/Berlin' };
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_kind: 'initial', p_config: { quiet_hours: quiet } });
    expect(vi.mocked(callDraftRpc).mock.calls[1][1]).toMatchObject({ p_kind: 'redraft', p_config: { quiet_hours: quiet } });
  });

  it('refuses a client-sent quiet_hours (server-side pack value only)', async () => {
    const response = await post({
      season_id: SEASON,
      kind: 'initial',
      config: { quiet_hours: { start_hour: 0, end_hour: 23, time_zone: 'UTC' } },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('answers 500 and creates nothing when the pack quiet window is invalid (deployment error)', async () => {
    vi.mocked(draftQuietHours).mockReturnValueOnce({ startHour: 0, endHour: 24, timeZone: 'UTC' });
    const response = await post({ season_id: SEASON, kind: 'initial' });
    expect(response.status).toBe(500);
    expect(callDraftRpc).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('rejects unknown keys with validation_failed', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', name: 'x' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
  });

  it('passes SQL rule errors through (POOL_EXISTS)', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('POOL_EXISTS'));
    const response = await post({ season_id: SEASON, kind: 'initial' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('POOL_EXISTS');
  });

  it('is season-admin only', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
    );
    expect((await post({ season_id: SEASON, kind: 'initial' })).status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});

// ─── League groups (one draft per group) ─────────────────────────────

describe('/api/drafts in a league with groups', () => {
  const SEASON = '00000000-0000-4000-a000-000000000002';
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const G1 = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const G2 = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const GROUPS = [
    { id: G1, season_id: SEASON, name: 'Group A', sort_order: 1, player_ids: [A, D] },
    { id: G2, season_id: SEASON, name: 'Group B', sort_order: 2, player_ids: [B, C] },
  ];
  const post = (body: unknown) => POST({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON, format_type: 'evolution_point_buy' } as never);
    // Roster order (= seed order): A, B, C, D.
    vi.mocked(getSeasonParticipants).mockResolvedValue(
      [{ id: A, name: 'Ash' }, { id: B, name: 'Brock' }, { id: C, name: 'Cilan' }, { id: D, name: 'Dawn' }] as never,
    );
    vi.mocked(getSeasonGroups).mockResolvedValue(GROUPS);
    vi.mocked(callDraftRpc).mockResolvedValue('new-pool');
  });

  afterEach(() => {
    vi.mocked(getSeasonGroups).mockResolvedValue([]);
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(null);
  });

  it('creates the group’s initial pool: seats are exactly its members, drawn within the group, and the group is named', async () => {
    const response = await post({ season_id: SEASON, kind: 'initial', season_group_id: G1 });
    expect(response.status).toBe(201);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_create_pool', {
      p_season_id: SEASON,
      p_kind: 'initial',
      p_actor_id: 'admin-1',
      p_config: { quiet_hours: null },
      p_seats: [{ player_id: D, seat: 1 }, { player_id: A, seat: 2 }],
      p_season_group_id: G1,
    });
    expect(expireDraftReads).toHaveBeenCalledWith(SEASON);
  });

  it('an admin order must be exactly the group’s members (another group’s trainer: SEATS_INVALID)', async () => {
    const ok = await post({ season_id: SEASON, kind: 'initial', season_group_id: G2, config: { participant_order: [C, B] } });
    expect(ok.status).toBe(201);
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({
      p_seats: [{ player_id: C, seat: 1 }, { player_id: B, seat: 2 }],
    });
    const refused = await post({
      season_id: SEASON,
      kind: 'initial',
      season_group_id: G2,
      config: { participant_order: [B, A] },
    });
    expect(refused.status).toBe(422);
    expect((await refused.json()).code).toBe('SEATS_INVALID');
    expect(callDraftRpc).toHaveBeenCalledTimes(1);
  });

  it('a league with groups needs the group (SEASON_GROUP_REQUIRED) and one of its own (SEASON_GROUP_INVALID)', async () => {
    const missing = await post({ season_id: SEASON, kind: 'initial' });
    expect(missing.status).toBe(409);
    expect((await missing.json()).code).toBe('SEASON_GROUP_REQUIRED');
    const foreign = await post({
      season_id: SEASON,
      kind: 'initial',
      season_group_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
    expect(foreign.status).toBe(422);
    expect((await foreign.json()).code).toBe('SEASON_GROUP_INVALID');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('a league without groups refuses a group id and sends no p_season_group_id (unchanged call)', async () => {
    vi.mocked(getSeasonGroups).mockResolvedValue([]);
    const refused = await post({ season_id: SEASON, kind: 'initial', season_group_id: G1 });
    expect((await refused.json()).code).toBe('SEASON_GROUP_INVALID');
    await post({ season_id: SEASON, kind: 'initial' });
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).not.toHaveProperty('p_season_group_id');
  });

  it('a redraft seats the group from its own first-half table: the league table (cross matches count) restricted to the group', async () => {
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: 't1', hinrunde_round_numbers: [1], hinrunde_complete: true,
    } as never);
    // League table best first; group B = {B, C}: C above B.
    vi.mocked(computeStandingsForSeason).mockResolvedValue(
      [{ player_id: A }, { player_id: C }, { player_id: D }, { player_id: B }] as never,
    );
    const response = await post({ season_id: SEASON, kind: 'redraft', season_group_id: G2 });
    expect(response.status).toBe(201);
    // The table is computed over the whole league (cross-group matches count), then restricted.
    expect(vi.mocked(computeStandingsForSeason).mock.calls[0][1]).toEqual([A, B, C, D]);
    const args = vi.mocked(callDraftRpc).mock.calls[0][1] as { p_seats: unknown; p_season_group_id: string };
    expect(args.p_season_group_id).toBe(G2);
    expect(args.p_seats).toEqual([
      { player_id: B, seat: 1, standing_rank: 2 },
      { player_id: C, seat: 2, standing_rank: 1 },
    ]);
  });

  it('a redraft prefers the group’s own first-half table (getGroupFirstHalfTables), passed best first', async () => {
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: 't1', hinrunde_round_numbers: [1, 2], hinrunde_complete: true,
    } as never);
    vi.mocked(getGroupFirstHalfTables).mockResolvedValueOnce({
      tournamentId: 't1',
      totalWeeks: 8,
      firstHalfLastWeek: 4,
      tables: new Map([[G2, [{ player_id: B }, { player_id: C }]]]),
    } as never);
    const response = await post({ season_id: SEASON, kind: 'redraft', season_group_id: G2 });
    expect(response.status).toBe(201);
    expect(computeStandingsForSeason).not.toHaveBeenCalled();
    expect((vi.mocked(callDraftRpc).mock.calls[0][1] as { p_seats: unknown }).p_seats).toEqual([
      { player_id: C, seat: 1, standing_rank: 2 },
      { player_id: B, seat: 2, standing_rank: 1 },
    ]);
  });

  it('a group table that does not hold exactly the members falls back to the restricted league table', async () => {
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({
      tournament_id: 't1', hinrunde_round_numbers: [1], hinrunde_complete: true,
    } as never);
    vi.mocked(getGroupFirstHalfTables).mockResolvedValueOnce({
      tournamentId: 't1', totalWeeks: 8, firstHalfLastWeek: 4, tables: new Map([[G2, [{ player_id: B }]]]),
    } as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue(
      [{ player_id: C }, { player_id: A }, { player_id: B }, { player_id: D }] as never,
    );
    await post({ season_id: SEASON, kind: 'redraft', season_group_id: G2 });
    expect((vi.mocked(callDraftRpc).mock.calls[0][1] as { p_seats: unknown }).p_seats).toEqual([
      { player_id: B, seat: 1, standing_rank: 2 },
      { player_id: C, seat: 2, standing_rank: 1 },
    ]);
  });

  it('a group’s POOL_EXISTS comes from the SQL per group and passes through', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('POOL_EXISTS'));
    const response = await post({ season_id: SEASON, kind: 'initial', season_group_id: G1 });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('POOL_EXISTS');
  });

  it('refuses a legacy pool in a league with groups before any write (draft_groups_need_point_buy)', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON, format_type: 'draft' } as never);
    const response = await post({ season_id: SEASON, draft_type: 'snake' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('draft_groups_need_point_buy');
    expect(createDraftPool).not.toHaveBeenCalled();
    expect(getDraftPoolBySeason).not.toHaveBeenCalled();
  });

  it('GET ?season_id= answers the caller’s own group’s initial pool', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue({ id: G2, season_id: SEASON, name: 'Group B', sort_order: 2 });
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValue({ ...mockPool, id: 'pool-b', season_group_id: G2 });
    const url = new URL(`http://localhost:3000/api/drafts?season_id=${SEASON}`);
    const response = await GET({ url: url.toString() } as unknown as NextRequest);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.id).toBe('pool-b');
    expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON, player.playerId);
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, G2, 'initial');
  });

  it('GET answers 404 INVALID_SEASON_ID for a malformed season id, before any read', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    const url = new URL('http://localhost:3000/api/drafts?season_id=nope');
    const response = await GET({ url: url.toString() } as unknown as NextRequest);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_SEASON_ID');
    expect(getDraftPoolBySeason).not.toHaveBeenCalled();
  });
});
