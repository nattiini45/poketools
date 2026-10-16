import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/streaks', () => ({
  getPlayerStreaks: vi.fn(),
}));

import { GET } from '../route';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetStreaks = getPlayerStreaks as ReturnType<typeof vi.fn>;

describe('GET /api/streaks/[playerId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns streaks for a player', async () => {
    const streaks = { player_id: 'p-1', current_streak: 5, best_streak: 8 };
    mockGetStreaks.mockResolvedValue(streaks);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(streaks);
    expect(mockGetStreaks).toHaveBeenCalledWith('p-1');
  });

  it('returns null when no streaks exist', async () => {
    mockGetStreaks.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it('returns 500 when query throws', async () => {
    mockGetStreaks.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch player streaks');
  });
});
