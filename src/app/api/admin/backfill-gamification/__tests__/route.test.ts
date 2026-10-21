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

vi.mock('@/lib/supabase/queries/streaks', () => ({
  upsertPlayerStreaks: vi.fn(),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  updateRatings: vi.fn(),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  recomputeStreaks: vi.fn(),
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
import { upsertPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { updateRatings } from '@/lib/rating/updateRatings';
import { recomputeStreaks, updateStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { checkAchievements } from '@/lib/gamification/achievements';
import { UserFacingError } from '@/lib/api/user-facing-error';

// ─── Helpers ────────────────────────────────────────────────────────

/** One `{ data, error }` result per page request (`.range()` is the terminal call). */
function mockSupabaseChain(...pages: Array<{ data: unknown; error?: unknown }>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
  };
  for (const page of pages) {
    chain.range.mockResolvedValueOnce({ data: page.data, error: page.error ?? null });
  }
  vi.mocked(supabase.from).mockReturnValue(chain as never);
  return chain;
}

/** Each built match is created one second after the previous one, so the
 * canonical replay order (`date_played ?? created_at`) is the build order. */
let createdSeq = 0;
const nextCreatedAt = () => new Date(Date.UTC(2026, 0, 1) + 1000 * createdSeq++).toISOString();

const match = (
  id: string,
  p1 = 'p1',
  p2 = 'p2',
  winner = p1,
  dates: { date_played?: string | null; created_at?: string } = {},
) => ({
  id,
  player_1_id: p1,
  player_2_id: p2,
  winner_id: winner,
  tournament_id: 't1',
  date_played: dates.date_played ?? null,
  created_at: dates.created_at ?? nextCreatedAt(),
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/admin/backfill-gamification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({});
  });

  it('returns error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    await POST();
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns processed=0 when no completed matches', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: [] });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ processed: 0, total: 0, errors: [] });
  });

  it('processes matches: ratings, streaks and achievements per match; reset, signatures and recompute once per player', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: [match('match-1'), match('match-2', 'p1', 'p3', 'p3')] });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ processed: 2, total: 2, errors: [] });
    expect(updateRatings).toHaveBeenNthCalledWith(1, 'p1', 'p2', false, 'match-1');
    expect(updateRatings).toHaveBeenNthCalledWith(2, 'p3', 'p1', false, 'match-2');
    expect(updateStreaks).toHaveBeenCalledTimes(4);
    expect(checkAchievements).toHaveBeenCalledTimes(4);
    // Replay-safe: each streak row is reset exactly once, then rebuilt from history.
    expect(vi.mocked(upsertPlayerStreaks).mock.calls.map((c) => c[0])).toEqual(['p1', 'p2', 'p3']);
    expect(vi.mocked(upsertPlayerStreaks).mock.calls.every((c) => c[1].best_win_streak === 0 && c[1].last_match_id === null)).toBe(true);
    expect(vi.mocked(recomputeStreaks).mock.calls.map((c) => c[0]).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(vi.mocked(updateSignatures).mock.calls.map((c) => c[0]).sort()).toEqual(['p1', 'p2', 'p3']);
    // The tournament is read once (cached).
    expect(getTournamentById).toHaveBeenCalledTimes(1);
  });

  it('gives each achievement check the chronological streak state as of that match', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    // p1 wins three in a row, then loses to p3.
    mockSupabaseChain({
      data: [
        match('m1', 'p1', 'p2'),
        match('m2', 'p1', 'p2'),
        match('m3', 'p1', 'p2'),
        match('m4', 'p1', 'p3', 'p3'),
      ],
    });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);
    vi.mocked(getBattleStatsByMatch).mockImplementation(async (matchId: string) => ({
      g1: [
        { player_id: 'p1', kos_dealt: matchId === 'm4' ? 0 : 3, was_koed: false },
        { player_id: 'p2', kos_dealt: 0, was_koed: true },
        { player_id: 'p3', kos_dealt: 4, was_koed: false },
      ],
    }) as never);

    // A stand-in for the stored player_streaks rows.
    const stored = new Map<string, { win: number; ko: number }>([
      // Stale pre-backfill state the replay must not build on.
      ['p1', { win: 9, ko: 9 }],
    ]);
    vi.mocked(upsertPlayerStreaks).mockImplementation(async (playerId: string) => {
      stored.set(playerId, { win: 0, ko: 0 });
      return {} as never;
    });
    vi.mocked(updateStreaks).mockImplementation(async (playerId, result, stats) => {
      const row = stored.get(playerId) ?? { win: 0, ko: 0 };
      stored.set(playerId, {
        win: result.won ? row.win + 1 : 0,
        ko: stats.total_kos_dealt >= 3 ? row.ko + 1 : 0,
      });
      return {} as never;
    });
    const seen: Array<[string, string, { win: number; ko: number } | undefined]> = [];
    vi.mocked(checkAchievements).mockImplementation(async (playerId, ctx) => {
      seen.push([ctx.match_id, playerId, stored.get(playerId) && { ...stored.get(playerId)! }]);
      return [];
    });

    await POST();

    const p1 = seen.filter(([, player]) => player === 'p1').map(([m, , row]) => [m, row]);
    expect(p1).toEqual([
      ['m1', { win: 1, ko: 1 }],
      ['m2', { win: 2, ko: 2 }],
      ['m3', { win: 3, ko: 3 }],
      ['m4', { win: 0, ko: 0 }],
    ]);
    expect(seen.find(([m, player]) => m === 'm4' && player === 'p3')?.[2]).toEqual({ win: 1, ko: 1 });
  });

  it('reads every page past the 1000-row cap, oldest first', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    const firstPage = Array.from({ length: 1000 }, (_, i) => match(`m-${i}`));
    const chain = mockSupabaseChain({ data: firstPage }, { data: [match('m-last')] });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: null } as never);

    const res = await POST();
    const json = await res.json();

    expect(json.data.total).toBe(1001);
    expect(chain.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(chain.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(chain.order).toHaveBeenNthCalledWith(1, 'date_played', { ascending: true, nullsFirst: false });
    expect(chain.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: true });
    expect(chain.order).toHaveBeenNthCalledWith(3, 'id', { ascending: true });
    expect(chain.order).not.toHaveBeenCalledWith('updated_at', expect.anything());
    expect(updateRatings).toHaveBeenLastCalledWith('p1', 'p2', false, 'm-last');
  });

  it('replays in date_played ?? created_at order, not in the order rows arrive', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    // A back-entered match: created (and confirmed) last, played first. An
    // undated match sorts by its created_at between the two dated ones.
    mockSupabaseChain({
      data: [
        match('late-entry-played-later', 'p1', 'p2', 'p1', { date_played: '2026-03-01T00:00:00Z', created_at: '2026-03-01T00:00:00Z' }),
        match('undated', 'p1', 'p2', 'p1', { date_played: null, created_at: '2026-02-01T00:00:00Z' }),
        match('back-entered', 'p1', 'p2', 'p1', { date_played: '2026-01-05T00:00:00Z', created_at: '2026-04-01T00:00:00Z' }),
      ],
    });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: null } as never);

    await POST();

    expect(vi.mocked(updateRatings).mock.calls.map((call) => call[3])).toEqual([
      'back-entered',
      'undated',
      'late-entry-played-later',
    ]);
    const streakOrder = vi.mocked(updateStreaks).mock.calls
      .filter((call) => call[0] === 'p1')
      .map((call) => call[3]);
    expect(streakOrder).toEqual(['back-entered', 'undated', 'late-entry-played-later']);
  });

  it('records errors per match without stopping', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: [match('match-1')] });
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.processed).toBe(0);
    expect(json.data.errors).toHaveLength(1);
    expect(json.data.errors[0]).toContain('match-1');
  });

  it('logs a failed rating write with its cause and continues with the next match', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: [match('match-1'), match('match-2')] });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);
    const err = new Error('rating_apply_match_result failed');
    vi.mocked(updateRatings).mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();
    const json = await res.json();

    expect(json.data.processed).toBe(1);
    // The step names the cause; the internal message stays in the log.
    expect(json.data.errors).toEqual(['Match match-1: ratings failed']);
    expect(JSON.stringify(json)).not.toContain('rating_apply_match_result');
    expect(logged).toHaveBeenCalledWith('[backfill] Match match-1 failed in step "ratings":', err);
    logged.mockRestore();
  });

  it('names the failed step per match, and keeps the safe message of a domain refusal', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: [match('match-1'), match('match-2')] });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);
    vi.mocked(updateStreaks).mockRejectedValueOnce(new Error('streak write failed'));
    vi.mocked(checkAchievements).mockRejectedValueOnce(
      new UserFacingError('Achievement catalogue is not loaded', { status: 503 }),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();
    const json = await res.json();

    expect(json.data.errors).toEqual([
      'Match match-1: streaks failed',
      'Match match-2: achievements failed: Achievement catalogue is not loaded',
    ]);
    logged.mockRestore();
  });

  it('names a failed streak recompute per player', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: [match('match-1')] });
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);
    vi.mocked(recomputeStreaks).mockRejectedValueOnce(new Error('recompute failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();
    const json = await res.json();

    expect(json.data.errors).toHaveLength(1);
    expect(json.data.errors[0]).toMatch(/^Player p[12]: streak recompute failed$/);
    logged.mockRestore();
  });

  it('propagates DB errors through safeErrorResponse', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    mockSupabaseChain({ data: null, error: new Error('Connection refused') });

    await POST();
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
