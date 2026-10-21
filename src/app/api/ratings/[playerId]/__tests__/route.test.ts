import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRating: vi.fn(),
}));

import { GET } from '../route';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetRating = getPlayerRating as ReturnType<typeof vi.fn>;

describe('GET /api/ratings/[playerId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the player rating', async () => {
    const rating = { player_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rating: 1500, rd: 200, vol: 0.06 };
    mockGetRating.mockResolvedValue(rating);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(rating);
    expect(mockGetRating).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('returns null when no rating exists', async () => {
    mockGetRating.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it('returns 500 when query throws', async () => {
    mockGetRating.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch player rating');
  });
});
