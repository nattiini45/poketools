import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignatures: vi.fn(),
}));

import { GET } from '../route';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetSignatures = getPlayerSignatures as ReturnType<typeof vi.fn>;

describe('GET /api/signatures/[playerId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns signatures for a player', async () => {
    const signatures = {
      player_id: 'p-1',
      pokemon: ['Garchomp', 'Togekiss', 'Rotom-Wash'],
    };
    mockGetSignatures.mockResolvedValue(signatures);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(signatures);
    expect(mockGetSignatures).toHaveBeenCalledWith('p-1');
  });

  it('returns null when no signatures exist', async () => {
    mockGetSignatures.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it('returns 500 when query throws', async () => {
    mockGetSignatures.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ playerId: 'p-1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch player signatures');
  });
});
