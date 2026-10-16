import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  updateRatings: vi.fn(),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  updateStreaks: vi.fn(),
}));

vi.mock('@/lib/gamification/signatures', () => ({
  updateSignatures: vi.fn(),
}));

vi.mock('@/lib/gamification/achievements', () => ({
  checkAchievements: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/admin/backfill-gamification/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { updateRatings } from '@/lib/rating/updateRatings';
import { updateStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { checkAchievements } from '@/lib/gamification/achievements';

// ─── Helpers ────────────────────────────────────────────────────────

function mockSupabaseChain(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  vi.mocked(supabase.from).mockReturnValue(chain as never);
  return chain;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/admin/backfill-gamification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    await POST();
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns processed=0 when no completed matches', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain([], null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.processed).toBe(0);
  });

  it('returns processed=0 when matches is null', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain(null, null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.processed).toBe(0);
  });

  it('processes matches through gamification pipeline', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain([
      {
        id: 'match-1',
        player_1_id: 'p1',
        player_2_id: 'p2',
        winner_id: 'p1',
        tournament_id: 't1',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ], null);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't1',
      season_id: 's1',
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      1: [
        { player_id: 'p1', kos_dealt: 3, was_koed: false },
        { player_id: 'p2', kos_dealt: 1, was_koed: true },
      ],
    } as never);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.processed).toBe(1);
    expect(json.data.errors).toEqual([]);
    expect(updateRatings).toHaveBeenCalledWith('p1', 'p2', false, 'match-1');
    expect(updateStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).toHaveBeenCalledTimes(2);
  });

  it('records errors per match without stopping', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain([
      {
        id: 'match-1',
        player_1_id: 'p1',
        player_2_id: 'p2',
        winner_id: 'p1',
        tournament_id: 't1',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ], null);
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.processed).toBe(0);
    expect(json.data.errors).toHaveLength(1);
    expect(json.data.errors[0]).toContain('match-1');
  });

  it('propagates DB errors through safeErrorResponse', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain(null, new Error('Connection refused'));

    await POST();
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
