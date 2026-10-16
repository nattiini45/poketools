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

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonsByPlayer: vi.fn(),
}));

import { GET } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getSeasonsByPlayer } from '@/lib/supabase/queries/seasons';

const mockRequirePlayer = requirePlayer as ReturnType<typeof vi.fn>;
const mockGetSeasons = getSeasonsByPlayer as ReturnType<typeof vi.fn>;

describe('GET /api/seasons/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns seasons for the authenticated player', async () => {
    const seasons = [
      { id: 's-1', name: 'Season 1', league_id: 'l-1' },
      { id: 's-2', name: 'Season 2', league_id: 'l-1' },
    ];
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
    mockGetSeasons.mockResolvedValue(seasons);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(seasons);
    expect(mockGetSeasons).toHaveBeenCalledWith('p-1');
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
    mockGetSeasons.mockRejectedValue(new Error('DB error'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch seasons');
  });
});
