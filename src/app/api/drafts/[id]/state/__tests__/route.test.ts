import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
  getPicksByPool: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getAllTiers: vi.fn(),
  getPlayerWildcards: vi.fn(async () => []),
}));

vi.mock('@/lib/draft/engine', () => ({
  computeDraftState: vi.fn(),
  resolveTotalRounds: vi.fn(),
  availablePricesSorted: vi.fn(() => null),
  legacyPickerStall: vi.fn(() => null),
  // Seat order is the engine's seeded draw (tested in engine.test.ts); here the read order stands.
  legacySeatOrder: vi.fn((_poolId: string, ids: string[]) => ids),
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  getPoolEntries: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/draft/point-buy-engine', () => ({
  computeDraftTokens: vi.fn(),
}));

vi.mock('@/lib/draft/progress-engine', () => ({
  loadDraftTokenLedger: vi.fn(),
  computeRemainingPointsFromLedger: vi.fn(),
  hasAllocatedDraftTokensFromLedger: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET } from '@/app/api/drafts/[id]/state/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById, getPicksByPool } from '@/lib/supabase/queries/drafts';
import { getSeasonParticipants, getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getAllTiers, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { computeDraftState, resolveTotalRounds } from '@/lib/draft/engine';
import { computeDraftTokens } from '@/lib/draft/point-buy-engine';
import {
  computeRemainingPointsFromLedger,
  hasAllocatedDraftTokensFromLedger,
  loadDraftTokenLedger,
} from '@/lib/draft/progress-engine';

// ─── Helpers ────────────────────────────────────────────────────────

const routeParams = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) };

function makeRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/drafts/pool-1/state${query}`);
}

const mockPool = {
  id: '11111111-1111-4111-8111-111111111111',
  season_id: 'season-1',
  draft_type: 'snake',
  status: 'in_progress',
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/drafts/[id]/state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 404 when pool not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(null);

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Draft pool not found');
    expect(json.code).toBe('POOL_NOT_FOUND');
  });

  it('returns 404 POOL_NOT_FOUND for a malformed pool id without a pool read', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'pool-1' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('POOL_NOT_FOUND');
    expect(getDraftPoolById).not.toHaveBeenCalled();
  });

  it('returns computed draft state with taken_pokemon as array', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' },
    ] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ format_type: 'draft' } as never);
    vi.mocked(getFormatRules).mockResolvedValue(null);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue({
      pool: mockPool,
      picks: [],
      rosters: {},
      budgets: {},
      pick_order: ['p1', 'p2'],
      current_picker: 'p1',
      next_pick_number: 1,
      current_round: 1,
      taken_pokemon: new Set(['Pikachu']),
    } as never);

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.taken_pokemon).toEqual(['Pikachu']);
    expect(json.data.current_picker).toBe('p1');
    expect(json.data.next_pick_number).toBe(1);
  });

  it('returns taken_line_identities for EPB seasons from trackers', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' },
    ] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ format_type: 'evolution_point_buy' } as never);
    vi.mocked(getFormatRules).mockResolvedValue({
      draft_budget: 180,
      draft_picks: 9,
      draft_token_ratio: 3,
      draft_token_max: 2,
    } as never);
    vi.mocked(getSeasonTrackers).mockResolvedValue([
      { base_pokemon: 'Eevee', locked_stage3_pokemon: 'Vaporeon' },
      { base_pokemon: 'Gastly', locked_stage3_pokemon: 'Gengar' },
    ] as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(9);
    vi.mocked(computeDraftState).mockReturnValue({
      pool: { ...mockPool, status: 'in_progress', point_budget: 180 },
      picks: [],
      rosters: {},
      budgets: { p1: 180, p2: 180 },
      pick_order: ['p1', 'p2'],
      current_picker: 'p1',
      next_pick_number: 1,
      current_round: 1,
      taken_pokemon: new Set(['Eevee', 'Gastly']),
    } as never);

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.taken_line_identities).toEqual(['Eevee|Vaporeon', 'Gastly|Gengar']);
    expect(json.data.epb).toMatchObject({
      draft_budget: 180,
      draft_picks: 9,
    });
    expect(getSeasonTrackers).toHaveBeenCalledWith('season-1');
    expect(computeDraftTokens).not.toHaveBeenCalled();
    expect(loadDraftTokenLedger).not.toHaveBeenCalled();
    expect(computeRemainingPointsFromLedger).not.toHaveBeenCalled();
    expect(hasAllocatedDraftTokensFromLedger).not.toHaveBeenCalled();
    // Trackers are opt-in: no tiers read and no evolution section by default.
    expect(getAllTiers).not.toHaveBeenCalled();
    expect(json.data.evolution).toBeUndefined();
  });

  it('refuses a legacy pool of a league group (409 POOL_ENGINE_LEGACY) before any season-wide read', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', season_group_id: 'group-1' } as never);

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('POOL_ENGINE_LEGACY');
    // `taken_line_identities` would come from season-wide trackers: none is read for a grouped pool.
    expect(getSeasonTrackers).not.toHaveBeenCalled();
    expect(getPicksByPool).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to compute draft state');
  });
});

// ─── EPB: trackers folded into /state, batched token math ─────────

describe('GET /api/drafts/[id]/state — EPB extras', () => {
  const epbRules = {
    draft_budget: 180,
    draft_picks: 9,
    draft_token_ratio: 3,
    draft_token_max: 2,
  };

  function tracker(playerId: string, base: string, form = base) {
    return {
      id: `t-${playerId}-${base}`,
      season_id: 'season-1',
      player_id: playerId,
      base_pokemon: base,
      current_form: form,
      current_stage: 1,
      total_kos: 0,
      locked_stage3_pokemon: null,
    };
  }

  function tier(base: string, playerId: string | null = null, stage2 = `${base}-2`) {
    return {
      id: `tier-${base}-${playerId ?? 'list'}`,
      season_id: 'season-1',
      player_id: playerId,
      base_pokemon: base,
      stage2_pokemon: stage2,
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: 'B',
      created_at: '2026-01-01',
    };
  }

  function wireEpb(status: 'in_progress' | 'complete') {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, status, point_budget: 180 } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([
      { player_id: 'p1', pokemon_name: 'Eevee', points_spent: 60 },
      { player_id: 'p2', pokemon_name: 'Gastly', points_spent: 40 },
    ] as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ format_type: 'evolution_point_buy' } as never);
    vi.mocked(getFormatRules).mockResolvedValue(epbRules as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(9);
    vi.mocked(computeDraftState).mockReturnValue({
      pool: { ...mockPool, status, point_budget: 180 },
      picks: [],
      rosters: { p1: ['Eevee'], p2: ['Gastly'] },
      budgets: { p1: 120, p2: 140 },
      pick_order: ['p1', 'p2'],
      current_picker: status === 'complete' ? null : 'p1',
      next_pick_number: 3,
      current_round: 2,
      taken_pokemon: new Set(['Eevee', 'Gastly']),
    } as never);
  }

  beforeEach(() => vi.clearAllMocks());

  it('rejects an unknown include value with 400 before touching the pool', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);

    const res = await GET(makeRequest('?include=players'), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('include must be one of: trackers');
    expect(json.code).toBe('INVALID_INCLUDE');
    expect(json.params).toEqual({ allowed: 'trackers' });
    expect(getDraftPoolById).not.toHaveBeenCalled();
  });

  it('checks auth before reading include', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await GET(makeRequest('?include=bogus'), routeParams);

    expect(res.status).toBe(401);
  });

  it("include=trackers returns every rostered player's trackers with tiers (wildcard first)", async () => {
    wireEpb('in_progress');
    vi.mocked(getSeasonTrackers).mockResolvedValue([
      tracker('p1', 'Eevee'),
      tracker('p2', 'Gastly', 'Haunter'),
      tracker('p9', 'Pichu'), // not rostered: ignored
    ] as never);
    vi.mocked(getAllTiers).mockResolvedValue([
      tier('Eevee'),
      tier('Eevee', 'p1', 'Vaporeon'), // p1's wildcard wins over the list tier
      tier('Gastly'),
      tier('Pichu'),
    ] as never);

    const res = await GET(makeRequest('?include=trackers'), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(getSeasonTrackers).toHaveBeenCalledTimes(1);
    expect(getAllTiers).toHaveBeenCalledTimes(1);
    expect(getAllTiers).toHaveBeenCalledWith('season-1');
    expect(json.data.evolution.is_evo_league).toBe(true);
    expect(Object.keys(json.data.evolution.trackers_by_player)).toEqual(['p1', 'p2']);
    expect(json.data.evolution.trackers_by_player.p1).toEqual([
      { ...tracker('p1', 'Eevee'), tier: tier('Eevee', 'p1', 'Vaporeon') },
    ]);
    expect(json.data.evolution.trackers_by_player.p2[0].tier).toEqual(tier('Gastly'));
    expect(json.data.evolution.trackers_by_player.p2[0].current_form).toBe('Haunter');
  });

  it('omits (and logs) a player whose tracker has no tier, like the old per-player call', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    wireEpb('in_progress');
    vi.mocked(getSeasonTrackers).mockResolvedValue([
      tracker('p1', 'Eevee'),
      tracker('p2', 'Missingno'),
    ] as never);
    vi.mocked(getAllTiers).mockResolvedValue([tier('Eevee')] as never);

    const res = await GET(makeRequest('?include=trackers'), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(json.data.evolution.trackers_by_player)).toEqual(['p1']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No evolution tier found for Missingno'));
    errorSpy.mockRestore();
  });

  it('reports is_evo_league false when the season has no tiers, and logs the trackers it omits', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    wireEpb('in_progress');
    vi.mocked(getSeasonTrackers).mockResolvedValue([tracker('p1', 'Eevee'), tracker('p2', 'Gastly')] as never);
    vi.mocked(getAllTiers).mockResolvedValue([]);

    const res = await GET(makeRequest('?include=trackers'), routeParams);
    const json = await res.json();

    expect(json.data.evolution).toEqual({ is_evo_league: false, trackers_by_player: {} });
    // Before: the trackers were dropped without a log line.
    expect(errorSpy).toHaveBeenCalledWith(
      '[api/drafts/state] No evolution tiers in season season-1; 2 trackers omitted',
    );
    errorSpy.mockRestore();
  });

  it('no tiers and no trackers yet (a season still being set up) is not logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    wireEpb('in_progress');
    vi.mocked(getSeasonTrackers).mockResolvedValue([] as never);
    vi.mocked(getAllTiers).mockResolvedValue([]);

    const res = await GET(makeRequest('?include=trackers'), routeParams);
    const json = await res.json();

    expect(json.data.evolution).toEqual({ is_evo_league: false, trackers_by_player: {} });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('ignores include=trackers for a non-EPB season', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(getPicksByPool).mockResolvedValue([]);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'p1' }] as never);
    vi.mocked(getSeasonById).mockResolvedValue({ format_type: 'draft' } as never);
    vi.mocked(resolveTotalRounds).mockReturnValue(6);
    vi.mocked(computeDraftState).mockReturnValue({
      pool: mockPool,
      picks: [],
      rosters: { p1: [] },
      budgets: null,
      pick_order: ['p1'],
      current_picker: 'p1',
      next_pick_number: 1,
      current_round: 1,
      taken_pokemon: new Set(),
    } as never);

    const res = await GET(makeRequest('?include=trackers'), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.evolution).toBeUndefined();
    expect(getSeasonTrackers).not.toHaveBeenCalled();
    expect(getAllTiers).not.toHaveBeenCalled();
    expect(getFormatRules).not.toHaveBeenCalled();
  });

  it('complete pool: loads the token ledger once and derives every participant from it', async () => {
    wireEpb('complete');
    vi.mocked(getSeasonTrackers).mockResolvedValue([] as never);
    const ledger = {
      picks: [],
      draftGrants: [],
      redrafts: [],
      draftTokenPurchases: [],
      redraftRefunds: [],
      initialPoolBudget: null,
    };
    vi.mocked(loadDraftTokenLedger).mockResolvedValue(ledger);
    vi.mocked(hasAllocatedDraftTokensFromLedger).mockImplementation((_l, pid) => pid === 'p1');
    vi.mocked(computeRemainingPointsFromLedger).mockImplementation((_l, pid) => (pid === 'p1' ? 3 : 9));
    vi.mocked(computeDraftTokens).mockImplementation((remaining) => Math.floor(remaining / 3));

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(loadDraftTokenLedger).toHaveBeenCalledTimes(1);
    expect(loadDraftTokenLedger).toHaveBeenCalledWith(
      'season-1',
      expect.objectContaining({ pool: expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }) }),
    );
    expect(computeRemainingPointsFromLedger).toHaveBeenCalledWith(ledger, 'p1', 180, 3);
    expect(computeRemainingPointsFromLedger).toHaveBeenCalledWith(ledger, 'p2', 180, 3);
    expect(json.data.epb).toEqual({
      draft_budget: 180,
      draft_picks: 9,
      token_ratio: 3,
      token_max: 2,
      picks_by_player: { p1: 1, p2: 1 },
      purchasable_tokens_by_player: { p1: 1, p2: 3 },
      tokens_allocated_by_player: { p1: true, p2: false },
    });
  });

  it('surfaces a ledger read failure as a 500 (no silent partial payload)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    wireEpb('complete');
    vi.mocked(getSeasonTrackers).mockResolvedValue([] as never);
    vi.mocked(loadDraftTokenLedger).mockRejectedValue(new Error('grants read failed'));

    const res = await GET(makeRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to compute draft state');
    errorSpy.mockRestore();
  });
});
