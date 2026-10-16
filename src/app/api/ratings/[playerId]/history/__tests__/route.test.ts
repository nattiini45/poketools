import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getRatingHistory: vi.fn(),
}));

import { GET } from '../route';
import { getRatingHistory } from '@/lib/supabase/queries/ratings';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetHistory = getRatingHistory as ReturnType<typeof vi.fn>;

describe('GET /api/ratings/[playerId]/history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns rating history with default limit', async () => {
    const history = [
      { id: 'rh-1', player_id: 'p-1', rating: 1500, created_at: '2025-01-01' },
      { id: 'rh-2', player_id: 'p-1', rating: 1520, created_at: '2025-01-15' },
    ];
    mockGetHistory.mockResolvedValue(history);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(history);
    expect(mockGetHistory).toHaveBeenCalledWith('p-1', 30);
  });

  it('respects custom limit parameter', async () => {
    mockGetHistory.mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { limit: '10' }),
      { params: makeParams({ playerId: 'p-1' }) },
    );
    await res.json();

    expect(mockGetHistory).toHaveBeenCalledWith('p-1', 10);
  });

  it('caps limit at 200', async () => {
    mockGetHistory.mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { limit: '999' }),
      { params: makeParams({ playerId: 'p-1' }) },
    );
    await res.json();

    expect(mockGetHistory).toHaveBeenCalledWith('p-1', 200);
  });

  it('falls back to 30 for invalid limit', async () => {
    mockGetHistory.mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { limit: 'abc' }),
      { params: makeParams({ playerId: 'p-1' }) },
    );
    await res.json();

    expect(mockGetHistory).toHaveBeenCalledWith('p-1', 30);
  });

  it('falls back to 30 for negative limit', async () => {
    mockGetHistory.mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { limit: '-5' }),
      { params: makeParams({ playerId: 'p-1' }) },
    );
    await res.json();

    expect(mockGetHistory).toHaveBeenCalledWith('p-1', 30);
  });

  it('falls back to 30 for zero limit', async () => {
    mockGetHistory.mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { limit: '0' }),
      { params: makeParams({ playerId: 'p-1' }) },
    );
    await res.json();

    expect(mockGetHistory).toHaveBeenCalledWith('p-1', 30);
  });

  it('returns 500 when query throws', async () => {
    mockGetHistory.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch rating history');
  });
});
