import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The real pick reader and the real engine run against a builder that answers like PostgREST under
// `max_rows = 1000`, so a pool past 1,000 picks is read the way production reads it.
const h = vi.hoisted(() => {
  const state = { pickCount: 0 };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.from = chain;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  const rowsOf = (from: number, to: number) => {
    const width = Math.min(to - from + 1, 1000);
    return Array.from({ length: Math.max(0, Math.min(width, state.pickCount - from)) }, (_, i) => {
      const n = from + i + 1;
      return {
        id: `pick-${String(n).padStart(5, '0')}`,
        draft_pool_id: 'pool',
        player_id: `p${(n - 1) % 21}`,
        pokemon_name: `Mon ${n}`,
        pick_number: n,
        round: Math.ceil(n / 21),
        points_spent: 0,
        timestamp: '2026-01-01T00:00:00Z',
        voided_at: null,
        players: { name: `Trainer ${(n - 1) % 21}` },
      };
    });
  };
  builder.range = (from: number, to: number) => Promise.resolve({ data: rowsOf(from, to), error: null });
  // A reader that does not page awaits the builder itself and is cut off at 1,000 rows.
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: rowsOf(0, 999), error: null }).then(resolve);
  return { state, builder };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ supabase: h.builder }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(async () => undefined),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/drafts')>()),
  getDraftPoolById: vi.fn(),
  completeLegacyPoolIfRunning: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
  getSeasonById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn() }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getAllTiers: vi.fn(),
  getPlayerWildcards: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({ getPoolEntries: vi.fn(async () => []) }));
vi.mock('@/lib/draft/point-buy-engine', () => ({ computeDraftTokens: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({
  loadDraftTokenLedger: vi.fn(),
  computeRemainingPointsFromLedger: vi.fn(),
  hasAllocatedDraftTokensFromLedger: vi.fn(),
}));

import { GET } from '@/app/api/drafts/[id]/state/route';
import { completeLegacyPoolIfRunning, getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const routeParams = { params: Promise.resolve({ id: POOL_ID }) };
const request = () => new NextRequest(`http://localhost/api/drafts/${POOL_ID}/state`);

describe('GET /api/drafts/[id]/state — a pool of 21 trainers over 50 rounds (1,050 picks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: POOL_ID,
      season_id: 'season-1',
      draft_type: 'snake',
      pick_order: 'snake',
      status: 'in_progress',
      engine: 'legacy',
      season_group_id: null,
      point_budget: null,
      team_size_mode: 'exact',
      team_size_exact: 50,
    } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `p${i}` })) as never,
    );
    vi.mocked(getSeasonById).mockResolvedValue({ format_type: 'draft' } as never);
    vi.mocked(completeLegacyPoolIfRunning).mockResolvedValue(true);
  });

  it('sees the last pick, so the pool completes lazily', async () => {
    h.state.pickCount = 1050;

    const res = await GET(request(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(completeLegacyPoolIfRunning).toHaveBeenCalledWith(POOL_ID);
    expect(json.data.pool.status).toBe('complete');
    expect(json.data.picks).toHaveLength(1050);
  });

  it('numbers the next pick after the 1,001st one instead of colliding on 1,001 forever', async () => {
    h.state.pickCount = 1049;

    const res = await GET(request(), routeParams);
    const json = await res.json();

    expect(json.data.next_pick_number).toBe(1050);
    expect(json.data.picks).toHaveLength(1049);
    expect(completeLegacyPoolIfRunning).not.toHaveBeenCalled();
  });
});
