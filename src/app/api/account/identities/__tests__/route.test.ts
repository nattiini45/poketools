import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { admin: { getUserById: vi.fn() } } },
}));

import { GET } from '@/app/api/account/identities/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';

describe('GET /api/account/identities error codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'player-1' } as Awaited<ReturnType<typeof requirePlayer>>);
  });

  it('answers a missing player row with 404 player_not_found, keeping the English text', async () => {
    vi.mocked(getPlayerById).mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ success: false, error: 'Player not found', code: 'player_not_found' });
  });
});
