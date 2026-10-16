import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentsByPlayer: vi.fn(),
}));

import { GET } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getTournamentsByPlayer } from '@/lib/supabase/queries/tournaments';

const mockRequirePlayer = requirePlayer as ReturnType<typeof vi.fn>;
const mockGetTournaments = getTournamentsByPlayer as ReturnType<typeof vi.fn>;

describe('GET /api/tournaments/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tournaments for the authenticated player', async () => {
    const tournaments = [
      { id: 't-1', name: 'Spring Cup', status: 'active' },
      { id: 't-2', name: 'Fall Classic', status: 'completed' },
    ];
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
    mockGetTournaments.mockResolvedValue(tournaments);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(tournaments);
    expect(mockGetTournaments).toHaveBeenCalledWith('p-1');
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
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
    mockGetTournaments.mockRejectedValue(new Error('DB error'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch tournaments');
  });
});
