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

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
}));

import { GET } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';

const mockRequirePlayer = requirePlayer as ReturnType<typeof vi.fn>;
const mockGetPlayer = getPlayerById as ReturnType<typeof vi.fn>;

describe('GET /api/players/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the current player profile', async () => {
    const player = { id: 'p-1', name: 'Alice', discord_id: '123' };
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
    mockGetPlayer.mockResolvedValue(player);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(player);
    expect(mockGetPlayer).toHaveBeenCalledWith('p-1');
  });

  it('returns 404 when player record not found', async () => {
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-missing' });
    mockGetPlayer.mockResolvedValue(null);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Player record not found');
    expect(json.code).toBe('player_not_found');
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
    expect(json.error).toBe('Failed to fetch profile');
  });
});
