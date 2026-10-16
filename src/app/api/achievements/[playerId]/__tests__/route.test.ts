import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/achievements', () => ({
  getPlayerAchievements: vi.fn(),
}));

import { GET } from '../route';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetAchievements = getPlayerAchievements as ReturnType<typeof vi.fn>;

describe('GET /api/achievements/[playerId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns earned achievements for a player', async () => {
    const achievements = [
      { id: 'ea-1', player_id: 'p-1', achievement_id: 'a-1', earned_at: '2025-01-01' },
    ];
    mockGetAchievements.mockResolvedValue(achievements);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(achievements);
    expect(mockGetAchievements).toHaveBeenCalledWith('p-1');
  });

  it('returns 500 when query throws', async () => {
    mockGetAchievements.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch player achievements');
  });
});
