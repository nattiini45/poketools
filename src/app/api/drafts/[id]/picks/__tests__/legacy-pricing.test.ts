/**
 * Legacy-engine pick pricing (Kilo 4245127326): the server prices the pick.
 * A budget pool's entry `point_cost` (else the pool's `default_point_cost`,
 * else 0) is the fixed price; an auction bid must be at least 1 (and reach the
 * entry cost when one is set; the pool default is no reserve); a pool without a
 * budget stores no points. A refused price comes after the turn, availability
 * and pool-entry checks. Only the acting player, or a pool admin (site admin or
 * a live resource-admin read) for a participant, can pick for a `player_id`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
  getPicksByPool: vi.fn(),
  createDraftPick: vi.fn(),
  updateDraftPoolStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonParticipants: vi.fn(), getSeasonById: vi.fn() }));
vi.mock('@/lib/draft/evolution-engine', () => ({ isEvoLeague: vi.fn() }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getTierByBasePokemon: vi.fn(),
  createTracker: vi.fn(),
  getSeasonTrackers: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntryByBaseAndStage3: vi.fn(),
  getListEntryByLineId: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn() }));
vi.mock('@/lib/supabase/queries/draft-tier-limits', () => ({ getTierLimits: vi.fn() }));
vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({ getPoolEntries: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerById: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { POST } from '@/app/api/drafts/[id]/picks/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { createDraftPick, getDraftPoolById, getPicksByPool } from '@/lib/supabase/queries/drafts';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { isEvoLeague } from '@/lib/draft/evolution-engine';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { getTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { getTierByBasePokemon } from '@/lib/supabase/queries/evolutions';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import { legacySeatOrder } from '@/lib/draft/engine';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';

const routeParams = { params: Promise.resolve({ id: POOL_ID }) };
const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const player = {
  playerId: ME,
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

/** Legacy pool in the order its draft_type implied before the split (auction/budget free, so the turn is never the gate). */
function legacyPool(
  draftType: 'auction' | 'budget' | 'snake',
  pointBudget: number | null,
  defaultPointCost: number | null = null,
) {
  return {
    id: POOL_ID,
    season_id: 'season-1',
    engine: 'legacy',
    draft_type: draftType,
    pick_order: draftType === 'snake' ? 'snake' : 'free',
    status: 'in_progress',
    point_budget: pointBudget,
    default_point_cost: defaultPointCost,
    team_size_mode: null,
    team_size_exact: null,
    total_rounds: 6,
  };
}

const entry = (pokemon: string, pointCost: number | null, powerTier: string | null = null) => ({
  id: `entry-${pokemon}`,
  season_id: 'season-1',
  pokemon_name: pokemon,
  power_tier: powerTier,
  point_cost: pointCost,
  created_at: '2026-10-01T00:00:00Z',
});

async function post(body: Record<string, unknown>) {
  const res = await POST(makeRequest(body), routeParams);
  return { status: res.status, json: (await res.json()) as { success: boolean; code?: string; error?: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(player as never);
  vi.mocked(isResourceAdminFor).mockResolvedValue(false);
  vi.mocked(getPicksByPool).mockResolvedValue([]);
  vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: ME }, { id: OTHER }] as never);
  vi.mocked(getSeasonById).mockResolvedValue(null);
  vi.mocked(getPoolEntries).mockResolvedValue([]);
  vi.mocked(getTierLimits).mockResolvedValue([]);
  vi.mocked(getTierByBasePokemon).mockResolvedValue(null);
  vi.mocked(isEvoLeague).mockResolvedValue(false);
  vi.mocked(getPlayerById).mockResolvedValue(null);
  vi.mocked(createDraftPick).mockImplementation(async (input) => ({ id: 'new-pick', ...input }) as never);
});

describe('legacy auction bids', () => {
  beforeEach(() => vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('auction', 100) as never));

  it.each([
    ['0 points', { points_spent: 0 }],
    ['negative points', { points_spent: -25 }],
    ['no points', {}],
    ['null points', { points_spent: null }],
    ['fractional points', { points_spent: 2.5 }],
    ['non-numeric points', { points_spent: 'lots' }],
  ])('refuses %s with 400 validation_failed and writes nothing', async (_label, extra) => {
    const { status, json } = await post({ pokemon_name: 'Pikachu', ...extra });

    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain('points_spent');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('stores a positive bid within the budget', async () => {
    const { status } = await post({ pokemon_name: 'Pikachu', points_spent: 30 });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ player_id: ME, points_spent: 30 }));
  });

  it('a bid must reach the pool entry cost', async () => {
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20)] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu', points_spent: 5 });

    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain('at least 20');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('the pool default_point_cost is no reserve: a bid of 1 stands', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('auction', 100, 15) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', null)] as never);

    const { status } = await post({ pokemon_name: 'Pikachu', points_spent: 1 });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ points_spent: 1 }));
  });

  it('a bid above the remaining budget is INSUFFICIENT_BUDGET', async () => {
    vi.mocked(getPicksByPool).mockResolvedValue([
      { id: 'p1', draft_pool_id: POOL_ID, player_id: ME, pokemon_name: 'Mew', pick_number: 1, round: 1, points_spent: 90 },
    ] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu', points_spent: 20 });

    expect(status).toBe(400);
    expect(json.code).toBe('INSUFFICIENT_BUDGET');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });
});

describe('legacy budget prices', () => {
  beforeEach(() => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20), entry('Mewtwo', 150)] as never);
  });

  it('charges the pool entry price, also when the client omits it', async () => {
    const { status } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ points_spent: 20 }));
  });

  it.each([0, -20, 5])('refuses a points_spent of %i that differs from the price', async (points) => {
    const { status, json } = await post({ pokemon_name: 'Pikachu', points_spent: points });

    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('checks the server price against the remaining budget', async () => {
    const { status, json } = await post({ pokemon_name: 'Mewtwo', points_spent: 1 });

    // The client's 1 is refused as a mismatch; without it the server price (150) is over budget.
    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    const again = await post({ pokemon_name: 'Mewtwo' });
    expect(again.status).toBe(400);
    expect(again.json.code).toBe('INSUFFICIENT_BUDGET');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('an entry without a cost is priced at the pool default_point_cost', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100, 12) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', null), entry('Eevee', 7)] as never);

    const plain = await post({ pokemon_name: 'Pikachu' });
    expect(plain.status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenLastCalledWith(expect.objectContaining({ points_spent: 12 }));

    // The entry's own cost beats the default.
    const own = await post({ pokemon_name: 'Eevee', points_spent: 7 });
    expect(own.status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenLastCalledWith(expect.objectContaining({ points_spent: 7 }));

    const mismatch = await post({ pokemon_name: 'Pikachu', points_spent: 1 });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json.code).toBe('validation_failed');
    expect(mismatch.json.error).toContain('costs 12');
  });

  it('with neither an entry cost nor a pool default the price is 0', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100, null) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', null)] as never);

    const { status } = await post({ pokemon_name: 'Pikachu' });
    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ points_spent: 0 }));

    const sent = await post({ pokemon_name: 'Pikachu', points_spent: 0 });
    expect(sent.status).toBe(201);
  });
});

describe('legacy error precedence', () => {
  it('NOT_IN_POOL comes before a refused budget price', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20)] as never);

    const { status, json } = await post({ pokemon_name: 'Mewtwo', points_spent: 3 });

    expect(status).toBe(400);
    expect(json.code).toBe('NOT_IN_POOL');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('NOT_IN_POOL comes before a missing auction bid', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('auction', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20)] as never);

    const { json } = await post({ pokemon_name: 'Mewtwo' });

    expect(json.code).toBe('NOT_IN_POOL');
  });

  it('an evo-league wildcard passes the pool check, then the price is checked', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20)] as never);
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getTierByBasePokemon).mockResolvedValue({ base_pokemon: 'Mewtwo' } as never);

    const { status, json } = await post({ pokemon_name: 'Mewtwo', points_spent: 3 });

    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain('points_spent');
  });

  it('a reached tier limit comes before a refused price', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20, 'S'), entry('Mew', 20, 'S')] as never);
    vi.mocked(getTierLimits).mockResolvedValue([{ power_tier: 'S', max_picks: 1 }] as never);
    vi.mocked(getPicksByPool).mockResolvedValue([
      { id: 'p1', draft_pool_id: POOL_ID, player_id: ME, pokemon_name: 'Mew', pick_number: 1, round: 1, points_spent: 20 },
    ] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu', points_spent: 3 });

    expect(status).toBe(400);
    expect(json.code).toBe('TIER_LIMIT_REACHED');
  });

  it('a taken Pokémon (validatePick) comes before everything else', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('budget', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20)] as never);
    vi.mocked(getPicksByPool).mockResolvedValue([
      { id: 'p1', draft_pool_id: POOL_ID, player_id: OTHER, pokemon_name: 'Pikachu', pick_number: 1, round: 1, points_spent: 20 },
    ] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu', points_spent: 3 });

    expect(status).toBe(400);
    expect(json.code).toBe('POKEMON_TAKEN');
  });
});

describe('legacy pools without a budget', () => {
  it('store no points, whatever the client sends', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('snake', null) as never);

    const { status } = await post({ pokemon_name: 'Pikachu', points_spent: 50 });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ points_spent: null }));
  });

  it('a snake pool with a stored budget still spends nothing (its pick form sends no points)', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('snake', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([entry('Pikachu', 20)] as never);

    const { status } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ points_spent: null }));
  });
});

describe('legacy picks for another player_id', () => {
  beforeEach(() => vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('auction', 100) as never));

  it('a participant cannot pick for someone else (403 ACTOR_NOT_ALLOWED)', async () => {
    const { status, json } = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });

    expect(status).toBe(403);
    expect(json.code).toBe('ACTOR_NOT_ALLOWED');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('an on-behalf pick reads resource-admin rights live, not from the session copy', async () => {
    // Stale session: the grant was made after sign-in, so the session copy still says no.
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isResourceAdmin: false } as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    const { status } = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });

    expect(status).toBe(201);
    expect(vi.mocked(isResourceAdminFor)).toHaveBeenCalledWith(ME, 'season', 'season-1');
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ player_id: OTHER }));
  });

  it('a revoked grant still in the session copy cannot pick on behalf', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isResourceAdmin: true } as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const { status, json } = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });

    expect(status).toBe(403);
    expect(json.code).toBe('ACTOR_NOT_ALLOWED');
  });

  it('a self pick never reads resource-admin rights', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isResourceAdmin: true } as never);

    const own = await post({ pokemon_name: 'Pikachu', points_spent: 10 });
    const explicit = await post({ pokemon_name: 'Eevee', player_id: ME, points_spent: 10 });

    expect(own.status).toBe(201);
    expect(explicit.status).toBe(201);
    expect(vi.mocked(isResourceAdminFor)).not.toHaveBeenCalled();
  });

  it('a non-participant self pick is refused without blaming player_id', async () => {
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: OTHER }] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu', points_spent: 10 });

    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe('You are not a participant of this league');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('a resource admin of another league cannot pick here', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isResourceAdmin: true } as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const { status, json } = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });

    expect(status).toBe(403);
    expect(json.code).toBe('ACTOR_NOT_ALLOWED');
    expect(vi.mocked(isResourceAdminFor)).toHaveBeenCalledWith(ME, 'season', 'season-1');
  });

  it('a malformed player_id is 400 validation_failed', async () => {
    const { status, json } = await post({ pokemon_name: 'Pikachu', player_id: 'player-2', points_spent: 10 });

    expect(status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('an admin picks for a participant, never for a player outside the league', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isAdmin: true } as never);

    const outside = await post({ pokemon_name: 'Pikachu', player_id: OUTSIDER, points_spent: 10 });
    expect(outside.status).toBe(400);
    expect(outside.json.code).toBe('validation_failed');
    expect(outside.json.error).toBe('player_id: not a participant of this league');
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();

    const inside = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });
    expect(inside.status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ player_id: OTHER, points_spent: 10 }));
  });
});

describe('legacy on-behalf picks are audited', () => {
  beforeEach(() => vi.mocked(getDraftPoolById).mockResolvedValue(legacyPool('auction', 100) as never));

  it('an admin pick for another participant writes a draft.pick.on_behalf entry', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isAdmin: true } as never);

    const { status } = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });

    expect(status).toBe(201);
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: ME,
        actor_name: 'Ash',
        action: 'draft.pick.on_behalf',
        resource_type: 'draft_pool',
        resource_id: POOL_ID,
        metadata: expect.objectContaining({
          season_id: 'season-1',
          target_player_id: OTHER,
          pokemon_name: 'Pikachu',
          points_spent: 10,
        }),
      }),
    );
  });

  it('a pick for oneself is not audited, also by an admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, isAdmin: true } as never);

    const own = await post({ pokemon_name: 'Pikachu', points_spent: 10 });
    const explicit = await post({ pokemon_name: 'Eevee', player_id: ME, points_spent: 10 });

    expect(own.status).toBe(201);
    expect(explicit.status).toBe(201);
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
  });

  it('a refused on-behalf pick is not audited', async () => {
    const { status } = await post({ pokemon_name: 'Pikachu', player_id: OTHER, points_spent: 10 });

    expect(status).toBe(403);
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
  });
});

describe('legacy pick order (pick_order separate from pricing)', () => {
  /** A 3-round pool for two seats: ME, then OTHER. */
  const pool = (draftType: 'snake' | 'budget', pickOrder: 'snake' | 'linear' | 'free', budget: number | null = null) => ({
    ...legacyPool(draftType, budget),
    pick_order: pickOrder,
    team_size_mode: 'exact',
    team_size_exact: 3,
  });
  const pick = (playerId: string, pokemon: string, n: number, points: number | null = null) => ({
    id: `p${n}`,
    draft_pool_id: POOL_ID,
    player_id: playerId,
    pokemon_name: pokemon,
    pick_number: n,
    round: Math.ceil(n / 2),
    points_spent: points,
  });

  it('fixture: the seeded seat order of this pool puts ME first, OTHER second (whatever the read order)', () => {
    expect(legacySeatOrder(POOL_ID, [ME, OTHER])).toEqual([ME, OTHER]);
    expect(legacySeatOrder(POOL_ID, [OTHER, ME])).toEqual([ME, OTHER]);
  });

  it('seats follow the pool, not the participant read order', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('snake', 'snake') as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: OTHER }, { id: ME }] as never);

    const { status } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ player_id: ME, pick_number: 1 }));
  });

  it('snake order with fixed costs refuses a pick that leaves too few points for the remaining rounds', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('budget', 'snake', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue(
      [entry('Pikachu', 20), entry('Mewtwo', 90), entry('Eevee', 30), entry('Ditto', 40)] as never,
    );

    const { status, json } = await post({ pokemon_name: 'Mewtwo' });

    expect(status).toBe(400);
    expect(json).toMatchObject({
      code: 'draft_pick_strands_roster',
      params: { slots: 2, min_cost: 50, remaining_after: 10 },
    });
    expect(json.error).toBe(
      'After this pick only 10 points would be left, but the remaining 2 picks cost at least 50 points.',
    );
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('snake order with fixed costs charges a pick that still leaves enough', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('budget', 'snake', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue(
      [entry('Pikachu', 20), entry('Mewtwo', 90), entry('Eevee', 30), entry('Ditto', 40)] as never,
    );

    const { status } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ player_id: ME, points_spent: 20 }));
  });

  it('free order with fixed costs keeps the old behaviour (no stall check: there is no turn to stall)', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('budget', 'free', 100) as never);
    vi.mocked(getPoolEntries).mockResolvedValue(
      [entry('Pikachu', 20), entry('Mewtwo', 90), entry('Eevee', 30), entry('Ditto', 40)] as never,
    );

    const { status } = await post({ pokemon_name: 'Mewtwo' });

    expect(status).toBe(201);
  });

  it('linear order: the first seat starts round 2 again, the second seat waits', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('snake', 'linear') as never);
    vi.mocked(getPicksByPool).mockResolvedValue([pick(ME, 'Mew', 1), pick(OTHER, 'Eevee', 2)] as never);

    expect((await post({ pokemon_name: 'Pikachu' })).status).toBe(201);
    expect(vi.mocked(createDraftPick)).toHaveBeenCalledWith(expect.objectContaining({ player_id: ME, round: 2 }));
  });

  it('snake order: the second seat starts round 2, so the first seat is refused', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('snake', 'snake') as never);
    vi.mocked(getPicksByPool).mockResolvedValue([pick(ME, 'Mew', 1), pick(OTHER, 'Eevee', 2)] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(400);
    expect(json.code).toBe('NOT_YOUR_TURN');
  });

  it('free order without points: a player who has all their rounds is refused (draft_roster_full)', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('snake', 'free') as never);
    vi.mocked(getPicksByPool).mockResolvedValue([pick(ME, 'Mew', 1), pick(ME, 'Eevee', 2), pick(ME, 'Ditto', 3)] as never);

    const { status, json } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(400);
    expect(json).toMatchObject({ code: 'draft_roster_full', params: { max: 3 }, error: 'This player already has all 3 picks' });
    expect(vi.mocked(createDraftPick)).not.toHaveBeenCalled();
  });

  it('free order: a participant picks off-turn, and no next picker is announced', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool('snake', 'free') as never);
    vi.mocked(getPicksByPool).mockResolvedValue([pick(ME, 'Mew', 1)] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'S1', format_type: 'draft' } as never);
    vi.mocked(getPlayerById).mockResolvedValue({ id: OTHER, name: 'Misty', discord_id: 'disc-2' } as never);
    const { emitDiscordEvent } = await import('@/lib/discord/notify');

    const { status } = await post({ pokemon_name: 'Pikachu' });

    expect(status).toBe(201);
    expect(vi.mocked(emitDiscordEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'draft_pick', next_picker_name: undefined, next_picker_discord_id: undefined }),
      }),
    );
  });
});
