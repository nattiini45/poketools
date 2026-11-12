import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/streaks', () => ({
  getStreakLeaderboard: vi.fn(),
}));

vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { hiddenPlayerIds: vi.fn(async () => ['p-3']) },
}));

import { GET } from '../route';
import { getStreakLeaderboard } from '@/lib/supabase/queries/streaks';

const mockGetLeaderboard = getStreakLeaderboard as ReturnType<typeof vi.fn>;

describe('GET /api/streaks/leaderboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the streak leaderboard', async () => {
    const leaderboard = [
      { player_id: 'p-1', current_streak: 5, best_streak: 8 },
      { player_id: 'p-2', current_streak: 3, best_streak: 6 },
    ];
    mockGetLeaderboard.mockResolvedValue(leaderboard);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(leaderboard);
  });

  it('leaves out players the public directory hides', async () => {
    mockGetLeaderboard.mockResolvedValue([
      { player_id: 'p-1', current_streak: 5, best_streak: 8 },
      { player_id: 'p-3', current_streak: 9, best_streak: 9 },
    ]);

    const json = await (await GET()).json();

    expect(json.data.map((row: { player_id: string }) => row.player_id)).toEqual(['p-1']);
  });

  it('returns 500 when query throws', async () => {
    mockGetLeaderboard.mockRejectedValue(new Error('db fail'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch streak leaderboard');
  });
});
