import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
  getPicksByPool: vi.fn(),
  createDraftPick: vi.fn(),
  completeLegacyPoolIfRunning: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/draft/engine', () => ({
  computeDraftState: vi.fn(),
  validatePick: vi.fn(),
  resolveTotalRounds: vi.fn(),
  isDraftComplete: vi.fn(),
  getRoundForPick: vi.fn(),
  rosterCompletionShortfall: vi.fn(() => null),
  availablePricesSorted: vi.fn(() => null),
  // Seat order is the engine's seeded draw (tested in engine.test.ts); here the read order stands.
  legacySeatOrder: vi.fn((_poolId: string, ids: string[]) => ids),
}));

vi.mock('@/lib/draft/evolution-engine', () => ({
  isEvoLeague: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getTierByBasePokemon: vi.fn(),
  getPlayerWildcards: vi.fn(async () => []),
  createTracker: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntryByBaseAndStage3: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/draft-tier-limits', () => ({
  getTierLimits: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  getPoolEntries: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST } from '@/app/api/drafts/[id]/picks/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import {
  getDraftPoolById,
  getPicksByPool,
  createDraftPick,
  completeLegacyPoolIfRunning,
} from '@/lib/supabase/queries/drafts';
import { getSeasonParticipants, getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  computeDraftState,
  validatePick,
  resolveTotalRounds,
  isDraftComplete,
  getRoundForPick,
} from '@/lib/draft/engine';
import { isEvoLeague } from '@/lib/draft/evolution-engine';
import { createTracker, getPlayerWildcards, getTierByBasePokemon } from '@/lib/supabase/queries/evolutions';
import { getListEntryByBaseAndStage3 } from '@/lib/supabase/queries/point-buy-lists';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { revalidateTag } from 'next/cache';
import { logger } from '@/lib/logger';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) };

const mockPlayer = {
  playerId: 'player-1',
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

/** A second participant's id: legacy `player_id` must be a uuid. */
const OTHER_PLAYER = '22222222-2222-4222-8222-222222222222';

const mockPool = {
  id: '11111111-1111-4111-8111-111111111111',
  season_id: 'season-1',
  draft_type: 'snake',
  pick_order: 'snake',
  status: 'in_progress',
};

const mockState = {
  pool: mockPool,
  picks: [],
  rosters: {},
  budgets: {},
  pick_order: ['player-1', 'player-2'],
  current_picker: 'player-1',
  turn_enforced: true,
  next_pick_number: 1,
  current_round: 1,
  taken_pokemon: new Set<string>(),
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/drafts/[id]/picks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns picks for a pool', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    const picks = [{ id: 'pick-1', pokemon_name: 'Pikachu' }];
    vi.mocked(getPicksByPool).mockResolvedValue(picks as never);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(picks);
  });
});

describe('POST /api/drafts/[id]/picks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEvoLeague).mockResolvedValue(false);
    vi.mocked(isDraftComplete).mockReturnValue(false);
    vi.mocked(getPoolEntries).mockResolvedValue([]);
    vi.mocked(getSeasonById).mockResolvedValue(null);
    vi.mocked(getPlayerById).mockResolvedValue(null);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 400 when pokemon_name is missing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    // The pool is read first: its engine picks the body schema (B-SNAP).
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);

    const res = await POST(makeRequest({}), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('pokemon_name');
    expect(json.code).toBe('validation_failed');
  });

  it('returns 404 when pool not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(null);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Draft pool not found');
    expect(json.code).toBe('POOL_NOT_FOUND');
  });

  it('returns 403 when non-admin tries to pick for another player', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const res = await POST(
      makeRequest({ pokemon_name: 'Pikachu', player_id: OTHER_PLAYER }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('only make picks for yourself');
    expect(json.code).toBe('ACTOR_NOT_ALLOWED');
  });

  it('returns 400 when validation fails', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue({ code: 'NOT_YOUR_TURN', message: 'Not your turn' });

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Not your turn');
    expect(json.code).toBe('NOT_YOUR_TURN');
  });

  it('creates a pick successfully', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getRoundForPick).mockReturnValue(1);
    const createdPick = { id: 'pick-1', pokemon_name: 'Pikachu', pick_number: 1 };
    vi.mocked(createDraftPick).mockResolvedValue(createdPick as never);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.pokemon_name).toBe('Pikachu');
    // D37: the pick shows on the league page's next view — its league tag only.
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([['season:season-1', { expire: 0 }]]);
  });

  it('rejects pokemon not in pool when pool entries exist', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getPoolEntries).mockResolvedValue([
      { pokemon_name: 'Charizard', power_tier: null },
    ] as never);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('not in the draft pool');
    expect(json.code).toBe('NOT_IN_POOL');
    expect(json.params).toEqual({ pokemon: 'Pikachu' });
  });

  it('emits next picker info in Discord event when draft is not done', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool)
      .mockResolvedValueOnce([])  // initial fetch
      .mockResolvedValueOnce([{ id: 'pick-1', pokemon_name: 'Pikachu', player_id: 'player-1', pick_number: 1 }] as never);  // post-pick fetch
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState)
      .mockReturnValueOnce(mockState as never) // initial state
      .mockReturnValueOnce({ ...mockState, next_pick_number: 2, current_picker: 'player-2' } as never); // post-pick state
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getRoundForPick).mockReturnValue(1);
    vi.mocked(createDraftPick).mockResolvedValue({ id: 'pick-1', pokemon_name: 'Pikachu', pick_number: 1 } as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'Season 5' } as never);
    vi.mocked(getPlayerById)
      .mockResolvedValueOnce({ name: 'Ash', discord_id: 'disc-1' } as never)  // pick player
      .mockResolvedValueOnce({ name: 'Misty', discord_id: 'disc-2' } as never);  // next picker

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    // Should have emitted draft_pick_made with next picker info
    const { emitDiscordEvent } = await import('@/lib/discord/notify');
    expect(vi.mocked(emitDiscordEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'draft_pick_made',
        data: expect.objectContaining({
          next_picker_name: 'Misty',
          next_picker_discord_id: 'disc-2',
        }),
      }),
    );
  });

  it('auto-completes draft and emits draft_completed event', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getRoundForPick).mockReturnValue(1);
    vi.mocked(isDraftComplete).mockReturnValue(true);
    vi.mocked(createDraftPick).mockResolvedValue({ id: 'pick-1', pokemon_name: 'Pikachu', pick_number: 1 } as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'Season 5' } as never);
    vi.mocked(getPlayerById).mockResolvedValue({ name: 'Ash', discord_id: 'disc-1' } as never);

    const { completeLegacyPoolIfRunning } = await import('@/lib/supabase/queries/drafts');
    const { emitDiscordEvent } = await import('@/lib/discord/notify');
    const { emitSocialEvent } = await import('@/lib/social/notify');

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(vi.mocked(completeLegacyPoolIfRunning)).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    // Two events: draft_pick_made + draft_completed
    expect(vi.mocked(emitDiscordEvent)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(emitSocialEvent)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(emitDiscordEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'draft_completed' }),
    );
  });

  it('creates evo tracker when picking in evo-league with tier', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getRoundForPick).mockReturnValue(1);
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getPoolEntries).mockResolvedValue([
      { pokemon_name: 'Pikachu', power_tier: null },
    ] as never);

    const { getTierByBasePokemon, createTracker } = await import('@/lib/supabase/queries/evolutions');
    vi.mocked(getTierByBasePokemon).mockResolvedValue({ id: 'tier-1' } as never);
    vi.mocked(createTracker).mockResolvedValue(undefined as never);
    vi.mocked(createDraftPick).mockResolvedValue({ id: 'pick-1', pokemon_name: 'Pikachu', pick_number: 1 } as never);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);

    expect(res.status).toBe(201);
    expect(vi.mocked(createTracker)).toHaveBeenCalledWith({
      season_id: 'season-1',
      player_id: 'player-1',
      base_pokemon: 'Pikachu',
    });
  });

  it('allows evo-league wildcard picks not in main pool', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getRoundForPick).mockReturnValue(1);
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getPoolEntries).mockResolvedValue([
      { pokemon_name: 'Charizard', power_tier: null },
    ] as never);

    vi.mocked(getPlayerWildcards).mockResolvedValue([{ id: 'wildcard-tier', base_pokemon: 'Pikachu' }] as never);
    vi.mocked(createDraftPick).mockResolvedValue({ id: 'pick-1', pokemon_name: 'Pikachu', pick_number: 1 } as never);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);

    expect(res.status).toBe(201);
  });

  it('rejects evo-league pick not in pool and not a wildcard', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getPoolEntries).mockResolvedValue([
      { pokemon_name: 'Charizard', power_tier: null },
    ] as never);

    vi.mocked(getPlayerWildcards).mockResolvedValue([]);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('not in the draft pool');
  });

  it('admin can pick on behalf of another player', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({
      ...mockPlayer,
      playerId: 'admin-1',
      isAdmin: true,
    } as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: OTHER_PLAYER }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getRoundForPick).mockReturnValue(1);
    vi.mocked(createDraftPick).mockResolvedValue({ id: 'pick-1', pokemon_name: 'Pikachu', player_id: OTHER_PLAYER, pick_number: 1 } as never);

    const res = await POST(
      makeRequest({ pokemon_name: 'Pikachu', player_id: OTHER_PLAYER }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: OTHER_PLAYER }),
    );
  });

  it('enforces tier limits on picks', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([
      { id: 'pick-1', player_id: 'player-1', pokemon_name: 'Gyarados', pick_number: 1 },
    ] as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue(mockState as never);
    vi.mocked(validatePick).mockReturnValue(null);
    vi.mocked(getPoolEntries).mockResolvedValue([
      { pokemon_name: 'Pikachu', power_tier: 'S' },
      { pokemon_name: 'Gyarados', power_tier: 'S' },
    ] as never);

    const { getTierLimits } = await import('@/lib/supabase/queries/draft-tier-limits');
    vi.mocked(getTierLimits).mockResolvedValue([{ power_tier: 'S', max_picks: 1 }] as never);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('S-tier limit reached');
    expect(json.code).toBe('TIER_LIMIT_REACHED');
    expect(json.params).toEqual({ tier: 'S', max: 1 });
  });
});

// ─── Evolution Point Buy: branched bases ────────────────────────────────

/**
 * A legacy-engine pool of a point-buy (EPB) season takes no pick at all: EPB seasons draft only
 * through the queue engine, whose completability gate guarantees a legal pick. The legacy EPB
 * pick path (bound-list lookup, line-keyed trackers) was retired with this refusal.
 */
describe('POST /api/drafts/[id]/picks — legacy pool of a point-buy season', () => {
  const epbPool = {
    id: '11111111-1111-4111-8111-111111111111',
    season_id: 'season-1',
    engine: 'legacy',
    draft_type: 'snake',
    pick_order: 'snake',
    point_budget: 180,
    team_size_mode: null,
    team_size_exact: null,
    status: 'in_progress',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDraftPoolById).mockResolvedValue(epbPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getPoolEntries).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: OTHER_PLAYER }] as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: 'season-1',
      name: 'EvoLiga S1',
      format_type: 'evolution_point_buy',
      point_buy_list_id: 'list-1',
    } as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
  });

  it.each([
    ['a self pick', { ...mockPlayer, playerId: 'player-1' }, { pokemon_name: 'Oshawott', stage3_pokemon: 'Samurott' }],
    [
      'an admin pick on behalf of a participant',
      { ...mockPlayer, playerId: 'player-1', isAdmin: true },
      { pokemon_name: 'Oshawott', stage3_pokemon: 'Samurott-Hisui', player_id: OTHER_PLAYER },
    ],
  ])('refuses %s with 409 POOL_ENGINE_LEGACY_EPB, before any pick rule or write', async (_label, viewer, body) => {
    vi.mocked(requirePlayer).mockResolvedValue(viewer as never);

    const res = await POST(makeRequest(body), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({ success: false, code: 'POOL_ENGINE_LEGACY_EPB' });
    expect(validatePick).not.toHaveBeenCalled();
    expect(getListEntryByBaseAndStage3).not.toHaveBeenCalled();
    expect(createDraftPick).not.toHaveBeenCalled();
    expect(createTracker).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/picks — legacy pool of a standard draft season', () => {
  const pick = (playerId: string, pokemon: string, n: number) => ({
    id: `pick-${n}`,
    draft_pool_id: '11111111-1111-4111-8111-111111111111',
    player_id: playerId,
    pokemon_name: pokemon,
    pick_number: n,
    round: 1,
    points_spent: null,
    timestamp: '2026-10-01T00:00:00Z',
    player_name: playerId,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import('@/lib/draft/engine')>('@/lib/draft/engine');
    vi.mocked(computeDraftState).mockImplementation(actual.computeDraftState);
    vi.mocked(validatePick).mockImplementation(actual.validatePick);
    vi.mocked(getRoundForPick).mockImplementation(actual.getRoundForPick);
    vi.mocked(isDraftComplete).mockReturnValue(false);
    vi.mocked(resolveTotalRounds).mockReturnValue(9);
    vi.mocked(isEvoLeague).mockResolvedValue(false);
    vi.mocked(getPoolEntries).mockResolvedValue([]);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', point_budget: null } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'S', format_type: 'draft' } as never);
    vi.mocked(getPlayerById).mockResolvedValue(null);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    vi.mocked(createDraftPick).mockImplementation(async (input) => ({ id: 'new-pick', ...input }) as never);
  });

  it('NOT_YOUR_TURN names no player: the body carries no UUID (B-HOT)', async () => {
    const onClock = '22222222-2222-4222-8222-222222222222';
    const waiting = '33333333-3333-4333-8333-333333333333';
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: onClock }, { id: waiting }] as never);
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: waiting } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(JSON.parse(text).code).toBe('NOT_YOUR_TURN');
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('keeps the name-taken check', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-2' } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([pick('player-1', 'Pikachu', 1)] as never);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('POKEMON_TAKEN');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('stores no line on a legacy pick', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-1' } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);

    expect(res.status).toBe(201);
    const input = vi.mocked(createDraftPick).mock.calls[0][0];
    expect(input).not.toHaveProperty('line_id');
    expect(input).not.toHaveProperty('line_entry_id');
    expect(getListEntryByBaseAndStage3).not.toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/picks — legacy pick names (#47)', () => {
  const POOL = '11111111-1111-4111-8111-111111111111';
  const pick = (playerId: string, pokemon: string, n: number) => ({
    id: `pick-${n}`,
    draft_pool_id: POOL,
    player_id: playerId,
    pokemon_name: pokemon,
    pick_number: n,
    round: 1,
    points_spent: null,
    timestamp: '2026-10-01T00:00:00Z',
    player_name: playerId,
  });
  const entry = (pokemon_name: string) => ({ pokemon_name, point_cost: null, power_tier: null, stage3_pokemon: null });
  const storedName = () => vi.mocked(createDraftPick).mock.calls[0][0].pokemon_name;

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import('@/lib/draft/engine')>('@/lib/draft/engine');
    vi.mocked(computeDraftState).mockImplementation(actual.computeDraftState);
    vi.mocked(validatePick).mockImplementation(actual.validatePick);
    vi.mocked(getRoundForPick).mockImplementation(actual.getRoundForPick);
    vi.mocked(isDraftComplete).mockReturnValue(false);
    vi.mocked(resolveTotalRounds).mockReturnValue(9);
    vi.mocked(isEvoLeague).mockResolvedValue(false);
    vi.mocked(getPoolEntries).mockResolvedValue([]);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', point_budget: null } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'S', format_type: 'draft', ruleset_id: null } as never);
    vi.mocked(getRulesetById).mockResolvedValue(null);
    vi.mocked(getPlayerById).mockResolvedValue(null);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-1' } as never);
    vi.mocked(createDraftPick).mockImplementation(async (input) => ({ id: 'new-pick', ...input }) as never);
  });

  describe('a league with a pool list', () => {
    beforeEach(() => {
      vi.mocked(getPoolEntries).mockResolvedValue([entry('Garchomp'), entry('Mr. Mime'), entry('Flabébé')] as never);
    });

    it('stores the pool entry spelling for a pick sent in another case', async () => {
      const res = await POST(makeRequest({ pokemon_name: 'garchomp' }), routeParams);

      expect(res.status).toBe(201);
      expect(storedName()).toBe('Garchomp');
    });

    it.each([
      ['mrmime', 'Mr. Mime'],
      ['MR MIME', 'Mr. Mime'],
      ['flabebe', 'Flabébé'],
    ])('resolves %s to the entry %s', async (sent, canonical) => {
      const res = await POST(makeRequest({ pokemon_name: sent }), routeParams);

      expect(res.status).toBe(201);
      expect(storedName()).toBe(canonical);
    });

    it('refuses a Pokémon taken in another spelling with POKEMON_TAKEN and writes nothing', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-2' } as never);
      vi.mocked(getPicksByPool).mockResolvedValue([pick('player-1', 'Garchomp', 1)] as never);

      const res = await POST(makeRequest({ pokemon_name: 'garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('POKEMON_TAKEN');
      expect(createDraftPick).not.toHaveBeenCalled();
    });

    it('treats a legacy row stored in another spelling as taken (availability maths use the same fold)', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-2' } as never);
      vi.mocked(getPicksByPool).mockResolvedValue([pick('player-1', 'mr mime', 1)] as never);

      const res = await POST(makeRequest({ pokemon_name: 'Mr. Mime' }), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('POKEMON_TAKEN');
    });

    it('a pick outside the list is still NOT_IN_POOL, not an unknown species', async () => {
      const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('NOT_IN_POOL');
      expect(createDraftPick).not.toHaveBeenCalled();
    });

    describe('an evolution wildcard assigned to the picker', () => {
      // The lookup answers per player, like the query: the wildcards of the player asked for, nobody else's.
      const wildcardsOf: Record<string, string[]> = { 'player-1': ['Eevee'], 'player-2': ['Ditto'] };

      beforeEach(() => {
        vi.mocked(isEvoLeague).mockResolvedValue(true);
        vi.mocked(getPlayerWildcards).mockImplementation((async (_seasonId: string, playerId: string) =>
          (wildcardsOf[playerId] ?? []).map((base) => ({ base_pokemon: base, player_id: playerId }))) as never);
        // Like the query: an exact match on the stored spelling, so a raw 'eevee' finds nothing.
        vi.mocked(getTierByBasePokemon).mockImplementation((async (_seasonId: string, base: string, playerId?: string | null) =>
          (wildcardsOf[playerId ?? ''] ?? []).includes(base)
            ? { base_pokemon: base, stage2_pokemon: 'Vaporeon' }
            : null) as never);
      });

      it.each(['Eevee', 'eevee', 'EEVEE', ' eevee '])(
        'stores the tier base name Eevee for %j and still creates its tracker',
        async (sent) => {
          const res = await POST(makeRequest({ pokemon_name: sent }), routeParams);

          expect(res.status).toBe(201);
          expect(storedName()).toBe('Eevee');
          expect(createTracker).toHaveBeenCalledWith(
            expect.objectContaining({ base_pokemon: 'Eevee', player_id: 'player-1' }),
          );
        },
      );

      it('looks the wildcard up for the picker, not for the pool', async () => {
        await POST(makeRequest({ pokemon_name: 'eevee' }), routeParams);

        expect(getPlayerWildcards).toHaveBeenCalledWith('season-1', 'player-1');
      });

      it("refuses a Pokémon that is another player's wildcard with NOT_IN_POOL", async () => {
        const res = await POST(makeRequest({ pokemon_name: 'ditto' }), routeParams);

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('NOT_IN_POOL');
        expect(createDraftPick).not.toHaveBeenCalled();
      });

      it('refuses a Pokémon that is neither listed nor a wildcard of the picker', async () => {
        const res = await POST(makeRequest({ pokemon_name: 'eevee2' }), routeParams);

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('NOT_IN_POOL');
      });

      it('reads no wildcard outside an evolution league', async () => {
        vi.mocked(isEvoLeague).mockResolvedValue(false);

        const res = await POST(makeRequest({ pokemon_name: 'eevee' }), routeParams);

        expect(res.status).toBe(400);
        expect(getPlayerWildcards).not.toHaveBeenCalled();
      });
    });
  });

  describe('a league without a pool list', () => {
    it.each([
      ['garchomp', 'Garchomp'],
      ['GARCHOMP', 'Garchomp'],
      ['mrmime', 'Mr. Mime'],
      ['Charizard-Mega-X', 'Charizard-Mega-X'],
    ])('accepts %s and stores the species name %s', async (sent, canonical) => {
      const res = await POST(makeRequest({ pokemon_name: sent }), routeParams);

      expect(res.status).toBe(201);
      expect(storedName()).toBe(canonical);
    });

    it.each(['Notamon', 'asdf qwer', 'Pikachu; DROP TABLE'])('refuses %s with UNKNOWN_SPECIES and writes nothing', async (sent) => {
      const res = await POST(makeRequest({ pokemon_name: sent }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toMatchObject({ success: false, code: 'UNKNOWN_SPECIES', params: { pokemon: sent } });
      expect(createDraftPick).not.toHaveBeenCalled();
    });

    it('refuses a Pokémon already taken in another spelling', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-2' } as never);
      vi.mocked(getPicksByPool).mockResolvedValue([pick('player-1', 'Garchomp', 1)] as never);

      const res = await POST(makeRequest({ pokemon_name: 'GARCHOMP' }), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('POKEMON_TAKEN');
    });

    it("resolves the species in the season ruleset's generation, else Gen 9", async () => {
      vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'S', format_type: 'draft', ruleset_id: 'rs-1' } as never);
      vi.mocked(getRulesetById).mockResolvedValue({ gen: 1, universe: 'standard' } as never);

      // Chikorita is a Gen 2 species: it does not exist in a Gen 1 ruleset.
      const res = await POST(makeRequest({ pokemon_name: 'Chikorita' }), routeParams);

      expect(getRulesetById).toHaveBeenCalledWith('rs-1');
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('UNKNOWN_SPECIES');
    });

    it('does not read a ruleset for a league whose pool has a list', async () => {
      vi.mocked(getPoolEntries).mockResolvedValue([entry('Garchomp')] as never);
      vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'S', format_type: 'draft', ruleset_id: 'rs-1' } as never);

      await POST(makeRequest({ pokemon_name: 'garchomp' }), routeParams);

      expect(getRulesetById).not.toHaveBeenCalled();
    });
  });

  it('no longer takes stage3_pokemon: the key is dropped, not stored and not refused', async () => {
    const res = await POST(makeRequest({ pokemon_name: 'Garchomp', stage3_pokemon: 'Garchomp-Mega' }), routeParams);

    expect(res.status).toBe(201);
    expect(vi.mocked(createDraftPick).mock.calls[0][0]).not.toHaveProperty('stage3_pokemon');
  });
});

describe('POST /api/drafts/[id]/picks — conflicts and post-insert failures (#48)', () => {
  const POOL = '11111111-1111-4111-8111-111111111111';
  const pgUnique = (index: string) => ({
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
    details: 'Key already exists.',
    hint: null,
  });
  const pick = (playerId: string, pokemon: string, n: number) => ({
    id: `pick-${n}`,
    draft_pool_id: POOL,
    player_id: playerId,
    pokemon_name: pokemon,
    pick_number: n,
    round: 1,
    points_spent: null,
    timestamp: '2026-10-01T00:00:00Z',
    player_name: playerId,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import('@/lib/draft/engine')>('@/lib/draft/engine');
    vi.mocked(computeDraftState).mockImplementation(actual.computeDraftState);
    vi.mocked(validatePick).mockImplementation(actual.validatePick);
    vi.mocked(getRoundForPick).mockImplementation(actual.getRoundForPick);
    vi.mocked(isDraftComplete).mockImplementation(actual.isDraftComplete);
    vi.mocked(resolveTotalRounds).mockReturnValue(9);
    vi.mocked(isEvoLeague).mockResolvedValue(false);
    vi.mocked(getPoolEntries).mockResolvedValue([{ pokemon_name: 'Garchomp', point_cost: null, power_tier: null }, { pokemon_name: 'Gengar', point_cost: null, power_tier: null }] as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', point_budget: null } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'S', format_type: 'draft', ruleset_id: null } as never);
    vi.mocked(getPlayerById).mockResolvedValue(null);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-1' } as never);
    vi.mocked(createDraftPick).mockImplementation(async (input) => ({ id: 'new-pick', ...input }) as never);
    vi.mocked(completeLegacyPoolIfRunning).mockResolvedValue(true);
  });

  describe('a collision on the pick number', () => {
    it('answers 409 PICK_CONFLICT after one re-validation when the pick is still legal, and logs the original error', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const collision = pgUnique('uq_draft_picks_pool_number_live');
      vi.mocked(createDraftPick).mockRejectedValue(collision);
      // Free order: the competing pick took pick 1, this one would still be legal as pick 2.
      vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', pick_order: 'free', point_budget: null } as never);
      vi.mocked(getPicksByPool)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pick('player-2', 'Gengar', 1)] as never);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toMatchObject({ success: false, code: 'PICK_CONFLICT' });
      expect(json.error).toBe('Another pick was made at the same moment. Reload the draft and try again.');
      expect(getPicksByPool).toHaveBeenCalledTimes(2);
      expect(createDraftPick).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('api/drafts/picks', 'legacy pick collided on a unique index', {
        index: 'uq_draft_picks_pool_number_live',
        error: collision,
      });
      error.mockRestore();
    });

    it('answers the precise refusal when the re-validation now fails: NOT_YOUR_TURN', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(createDraftPick).mockRejectedValue(pgUnique('uq_draft_picks_pool_number_live'));
      vi.mocked(getPicksByPool)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pick('player-1', 'Gengar', 1)] as never);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('NOT_YOUR_TURN');
    });

    it('answers the precise refusal when the competing pick took the same Pokémon: POKEMON_TAKEN', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(createDraftPick).mockRejectedValue(pgUnique('uq_draft_picks_pool_number_live'));
      vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', pick_order: 'free', point_budget: null } as never);
      vi.mocked(getPicksByPool)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pick('player-2', 'Garchomp', 1)] as never);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('POKEMON_TAKEN');
    });

    it('never answers 500 and writes no audit row, tracker or completion for the loser', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(createDraftPick).mockRejectedValue(pgUnique('uq_draft_picks_pool_number_live'));
      vi.mocked(getPicksByPool).mockResolvedValue([]);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);

      expect(res.status).toBeLessThan(500);
      expect(createTracker).not.toHaveBeenCalled();
      expect(completeLegacyPoolIfRunning).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });
  });

  describe('a collision on the Pokémon name', () => {
    it('answers 400 POKEMON_TAKEN, distinguishing the index by name, and logs the original error', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const collision = pgUnique('uq_draft_picks_legacy_name_live');
      vi.mocked(createDraftPick).mockRejectedValue(collision);

      const res = await POST(makeRequest({ pokemon_name: 'garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toMatchObject({ success: false, code: 'POKEMON_TAKEN', error: 'Garchomp has already been drafted' });
      expect(getPicksByPool).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('api/drafts/picks', 'legacy pick collided on a unique index', {
        index: 'uq_draft_picks_legacy_name_live',
        error: collision,
      });
      error.mockRestore();
    });
  });

  it('still fails a unique violation of an unknown index (nothing is swallowed)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createDraftPick).mockRejectedValue(pgUnique('some_other_index'));

    const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);

    expect(res.status).toBe(500);
  });

  describe('failures after the pick committed', () => {
    it('answers 201 with a coded warning and a log line when the tracker is not created', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.mocked(isEvoLeague).mockResolvedValue(true);
      vi.mocked(getTierByBasePokemon).mockResolvedValue({ base_pokemon: 'Garchomp' } as never);
      const failure = new Error('connection reset');
      vi.mocked(createTracker).mockRejectedValue(failure);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.data.pokemon_name).toBe('Garchomp');
      expect(json.warnings).toEqual(['TRACKER_NOT_CREATED']);
      expect(error).toHaveBeenCalledWith(
        'api/drafts/picks',
        'pick committed but its evolution tracker was not created',
        { error: failure }
      );
      expect(vi.mocked(revalidateTag).mock.calls).toEqual([['season:season-1', { expire: 0 }]]);
      error.mockRestore();
    });

    it('treats a tracker that already exists as created (idempotent), with no warning', async () => {
      vi.mocked(isEvoLeague).mockResolvedValue(true);
      vi.mocked(getTierByBasePokemon).mockResolvedValue({ base_pokemon: 'Garchomp' } as never);
      vi.mocked(createTracker).mockRejectedValue(pgUnique('uq_evolution_tracker_legacy_base'));

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toBeUndefined();
    });

    it('answers 201 with a coded warning and a log line when the pool is not flipped to complete', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }] as never);
      vi.mocked(resolveTotalRounds).mockReturnValue(1);
      const failure = new Error('statement timeout');
      vi.mocked(completeLegacyPoolIfRunning).mockRejectedValue(failure);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toEqual(['POOL_COMPLETION_PENDING']);
      expect(error).toHaveBeenCalledWith(
        'api/drafts/picks',
        'last pick committed but the pool was not set to complete',
        { error: failure }
      );
      error.mockRestore();
    });

    it('does not overwrite a pool that is no longer running (guarded completion): 201, no warning, a log line', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'player-1' }] as never);
      vi.mocked(resolveTotalRounds).mockReturnValue(1);
      vi.mocked(completeLegacyPoolIfRunning).mockResolvedValue(false);

      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.warnings).toBeUndefined();
      expect(completeLegacyPoolIfRunning).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'api/drafts/picks',
        'last pick committed but the pool was no longer running, so it was not completed',
        { poolId: '11111111-1111-4111-8111-111111111111' }
      );
      warn.mockRestore();
    });

    it('carries no warnings on a clean pick', async () => {
      const res = await POST(makeRequest({ pokemon_name: 'Garchomp' }), routeParams);

      expect(res.status).toBe(201);
      expect((await res.json()).warnings).toBeUndefined();
    });
  });
});
