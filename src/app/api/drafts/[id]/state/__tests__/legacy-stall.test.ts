/**
 * Legacy branch of GET /api/drafts/[id]/state: the seat order is the pool's seeded draw (not the participant read
 * order), and a fixed-price draft in turn order reports a current picker who cannot afford a pick that completes
 * their roster (`stalled_picker`). The engine is real; only the reads are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(async () => ({ playerId: 'viewer', isAdmin: false, isResourceAdmin: false })),
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn(), getPicksByPool: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
  getSeasonById: vi.fn(async () => ({ id: 'season-1', format_type: 'draft' })),
}));
vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({ getPoolEntries: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(async () => []),
  getAllTiers: vi.fn(),
  getPlayerWildcards: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({
  loadDraftTokenLedger: vi.fn(),
  computeRemainingPointsFromLedger: vi.fn(),
  hasAllocatedDraftTokensFromLedger: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));

import { GET } from '@/app/api/drafts/[id]/state/route';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { getPlayerWildcards } from '@/lib/supabase/queries/evolutions';
import { legacySeatOrder } from '@/lib/draft/engine';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const [FIRST, SECOND] = legacySeatOrder(POOL_ID, ['p1', 'p2']);

/** 3 rounds, 100 points each; snake order and fixed prices unless overridden. */
const pool = (overrides: Record<string, unknown> = {}) => ({
  id: POOL_ID,
  season_id: 'season-1',
  engine: 'legacy',
  draft_type: 'budget',
  pick_order: 'snake',
  status: 'in_progress',
  point_budget: 100,
  default_point_cost: null,
  team_size_mode: 'exact',
  team_size_exact: 3,
  ...overrides,
});
const entry = (pokemon_name: string, point_cost: number | null) => ({ id: pokemon_name, season_id: 'season-1', pokemon_name, point_cost });

async function getState() {
  const res = await GET(new NextRequest(`http://localhost/api/drafts/${POOL_ID}/state`), {
    params: Promise.resolve({ id: POOL_ID }),
  });
  const json = (await res.json()) as {
    data: { pick_order: string[]; current_picker: string; stalled_picker: Record<string, unknown> | null };
  };
  return json.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
  vi.mocked(getDraftPoolById).mockResolvedValue(pool() as never);
  // The cheapest three cost 40 + 40 + 50 = 130 > 100: the first seat is stuck from the start.
  vi.mocked(getPoolEntries).mockResolvedValue([entry('A', 50), entry('B', 40), entry('C', 40), entry('D', 90)] as never);
});

describe('GET /api/drafts/[id]/state — legacy seat order', () => {
  it('seats do not depend on the order the participants were read in', async () => {
    const first = await getState();
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: 'p2' }, { id: 'p1' }] as never);
    const second = await getState();

    expect(first.pick_order).toEqual([FIRST, SECOND]);
    expect(second.pick_order).toEqual([FIRST, SECOND]);
    expect(second.current_picker).toBe(FIRST);
  });
});

describe('GET /api/drafts/[id]/state — stalled_picker', () => {
  it('reports the current picker who cannot afford the cheapest completion of their roster', async () => {
    expect((await getState()).stalled_picker).toEqual({ player_id: FIRST, remaining: 100, open_slots: 3, min_cost: 130 });
  });

  it('is null while the cheapest completion fits, without reading wildcards', async () => {
    vi.mocked(getPoolEntries).mockResolvedValue([entry('A', 30), entry('B', 30), entry('C', 40)] as never);
    expect((await getState()).stalled_picker).toBeNull();
    expect(vi.mocked(getPlayerWildcards)).not.toHaveBeenCalled();
  });

  it("a stuck picker's undrafted wildcard outside the pool list (priced at the pool default) clears the stall", async () => {
    // Default 10 + the cheapest two pool prices (40 + 40) = 90 <= 100: the picks route accepts the wildcard.
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ default_point_cost: 10 }) as never);
    vi.mocked(getPlayerWildcards).mockResolvedValue([{ base_pokemon: 'Eevee', player_id: FIRST }] as never);

    expect((await getState()).stalled_picker).toBeNull();
    expect(vi.mocked(getPlayerWildcards)).toHaveBeenCalledWith('season-1', FIRST);
  });

  it('a wildcard that is in the pool list or already taken does not count', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ default_point_cost: 10 }) as never);
    vi.mocked(getPlayerWildcards).mockResolvedValue([{ base_pokemon: 'a', player_id: FIRST }] as never);

    expect((await getState()).stalled_picker).toMatchObject({ player_id: FIRST, min_cost: 130 });
  });

  it('prices entries without a cost at the pool default, and every open pick at it without a pool list', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ default_point_cost: 40 }) as never);
    vi.mocked(getPoolEntries).mockResolvedValue([] as never);
    expect((await getState()).stalled_picker).toMatchObject({ min_cost: 120 });

    vi.mocked(getPoolEntries).mockResolvedValue([entry('A', null), entry('B', 10), entry('C', 10)] as never);
    expect((await getState()).stalled_picker).toBeNull();
  });

  it.each([
    ['free order', { pick_order: 'free' }],
    ['no points (snake pricing)', { draft_type: 'snake', point_budget: null }],
    ['a pending pool', { status: 'pending' }],
  ])('is null and reads no pool list for %s', async (_label, overrides) => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool(overrides) as never);

    expect((await getState()).stalled_picker).toBeNull();
    expect(vi.mocked(getPoolEntries)).not.toHaveBeenCalled();
  });

  it('is null and reads no pool list for an Evolution Point Buy season (it prices from its bound list)', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', format_type: 'evolution_point_buy' } as never);
    expect((await getState()).stalled_picker ?? null).toBeNull();
    expect(vi.mocked(getPoolEntries)).not.toHaveBeenCalled();
  });
});
