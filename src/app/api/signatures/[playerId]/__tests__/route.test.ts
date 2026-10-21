import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignatures: vi.fn(),
}));

import { GET } from '../route';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetSignatures = getPlayerSignatures as ReturnType<typeof vi.fn>;

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/signatures/[playerId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns signatures for a player', async () => {
    const signatures = {
      player_id: PLAYER_ID,
      pokemon: ['Garchomp', 'Togekiss', 'Rotom-Wash'],
    };
    mockGetSignatures.mockResolvedValue(signatures);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: PLAYER_ID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(signatures);
    expect(mockGetSignatures).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('returns null when no signatures exist', async () => {
    mockGetSignatures.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: makeParams({ playerId: PLAYER_ID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  it('returns 500 when query throws', async () => {
    mockGetSignatures.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ playerId: PLAYER_ID }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch player signatures');
  });
  it.each(['p-1', 'abc', 'nonexistent', `${PLAYER_ID}x`, "1' OR '1'='1"])(
    'returns 404 INVALID_PLAYER_ID for malformed id %j without querying',
    async (playerId) => {
      const res = await GET(makeRequest(), { params: makeParams({ playerId }) });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json).toEqual({ success: false, error: 'Player not found', code: 'INVALID_PLAYER_ID' });
      expect(mockGetSignatures).not.toHaveBeenCalled();
    }
  );
});
