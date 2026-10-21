import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requirePlayer: vi.fn(), AuthError };
});

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

import { GET } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';

const mockRequirePlayer = requirePlayer as ReturnType<typeof vi.fn>;
const mockGetMatches = getMatchesByPlayer as ReturnType<typeof vi.fn>;

describe('GET /api/matches/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns matches for the authenticated player', async () => {
    const matches = [
      { id: 'm-1', player1_id: 'p-1', player2_id: 'p-2', status: 'completed' },
      { id: 'm-2', player1_id: 'p-1', player2_id: 'p-3', status: 'pending' },
    ];
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
    mockGetMatches.mockResolvedValue(matches);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(matches);
    expect(mockGetMatches).toHaveBeenCalledWith('p-1');
  });

  it('returns auth error when not authenticated', async () => {
    mockRequirePlayer.mockRejectedValue(new AuthError('Not authenticated', 401));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Not authenticated');
  });

  it('returns 500 on unexpected error', async () => {
    mockRequirePlayer.mockRejectedValue(new Error('DB error'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch matches');
  });
});
