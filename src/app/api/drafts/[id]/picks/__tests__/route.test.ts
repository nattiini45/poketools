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
  updateDraftPoolStatus: vi.fn(),
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

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST } from '@/app/api/drafts/[id]/picks/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import {
  getDraftPoolById,
  getPicksByPool,
  createDraftPick,
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
import { createTracker } from '@/lib/supabase/queries/evolutions';
import { getListEntryByBaseAndStage3 } from '@/lib/supabase/queries/point-buy-lists';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { revalidateTag } from 'next/cache';

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

    const { updateDraftPoolStatus } = await import('@/lib/supabase/queries/drafts');
    const { emitDiscordEvent } = await import('@/lib/discord/notify');
    const { emitSocialEvent } = await import('@/lib/social/notify');

    const res = await POST(makeRequest({ pokemon_name: 'Pikachu' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(vi.mocked(updateDraftPoolStatus)).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'complete');
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

    const { getTierByBasePokemon } = await import('@/lib/supabase/queries/evolutions');
    vi.mocked(getTierByBasePokemon).mockResolvedValue({ id: 'wildcard-tier' } as never);
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

    const { getTierByBasePokemon } = await import('@/lib/supabase/queries/evolutions');
    vi.mocked(getTierByBasePokemon).mockResolvedValue(null);

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

// ─── Evolution Point Buy: branched bases (draft-backend §13.1, B-HOT) ───

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
