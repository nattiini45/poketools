import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

import { GET } from '../route';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetRounds = getRoundsByTournament as ReturnType<typeof vi.fn>;

describe('GET /api/tournaments/[id]/rounds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns rounds for a tournament', async () => {
    const rounds = [
      { id: 'r-1', tournament_id: 't-1', round_number: 1 },
      { id: 'r-2', tournament_id: 't-1', round_number: 2 },
    ];
    mockGetRounds.mockResolvedValue(rounds);

    const res = await GET(makeRequest(), { params: makeParams({ id: 't-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(rounds);
    expect(mockGetRounds).toHaveBeenCalledWith('t-1');
  });

  it('returns 500 when query throws', async () => {
    mockGetRounds.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ id: 't-1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch rounds');
  });
});
