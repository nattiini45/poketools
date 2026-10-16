import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@/types/player';

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: cookieSet }),
}));

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

// The route imports LINK_DISCORD_COOKIE from @/auth, which would pull the
// full NextAuth config (and its env requirements) into the test.
vi.mock('@/auth', () => ({
  LINK_DISCORD_COOKIE: '__poketools_link_discord',
}));

import { POST } from '@/app/api/account/link-discord/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { verifyLinkToken } from '@/lib/utils/crypto';

const emailOnlyPlayer: Player = {
  id: 'player-1',
  name: 'Misty',
  discord_id: null,
  auth_user_id: 'auth-1',
  ps_username: '',
  champions_username: '',
  is_admin: false,
  is_creator: false,
  is_test_account: false,
  is_guest: false,
  joined_date: null,
  avatar_url: null,
  avatar_config: null,
  status: 'active',
  suspended_until: null,
  ban_reason: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('POST /api/account/link-discord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'player-1' } as Awaited<ReturnType<typeof requirePlayer>>);
    vi.mocked(getPlayerById).mockResolvedValue(emailOnlyPlayer);
  });

  it('returns 409 when Discord is already linked', async () => {
    vi.mocked(getPlayerById).mockResolvedValue({ ...emailOnlyPlayer, discord_id: '123' });

    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('discord_already_linked');
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('sets a signed, HttpOnly intent cookie carrying the player id', async () => {
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, token, options] = cookieSet.mock.calls[0];
    expect(name).toBe('__poketools_link_discord');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    // Token must verify against the same secret and resolve to the player id
    expect(verifyLinkToken(token, 'test-nextauth-secret')).toBe('player-1');
  });
});
