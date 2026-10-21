import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Player } from '@/types/player';

const signUp = vi.fn();

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { signUp } }),
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
  linkAuthUserToPlayer: vi.fn(),
}));

import { POST } from '@/app/api/account/link-email/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById, linkAuthUserToPlayer } from '@/lib/supabase/queries/players';

const mockPlayer: Player = {
  id: 'player-1',
  name: 'Ash',
  discord_id: '123456789',
  auth_user_id: null,
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

function makeRequest(body: Record<string, unknown>, cookie?: string): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(cookie ? { cookie } : {}),
  } as unknown as NextRequest;
}

const VALID_BODY = { email: 'ash@example.com', password: 'pikachu123' };

describe('POST /api/account/link-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'player-1' } as Awaited<ReturnType<typeof requirePlayer>>);
    vi.mocked(getPlayerById).mockResolvedValue(mockPlayer);
  });

  it('returns 409 when an email login is already linked', async () => {
    vi.mocked(getPlayerById).mockResolvedValue({ ...mockPlayer, auth_user_id: 'auth-0' });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('email_login_already_linked');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('returns 404 player_not_found when the session player row is gone', async () => {
    vi.mocked(getPlayerById).mockResolvedValue(null);

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ error: 'Player not found', code: 'player_not_found' });
  });

  it('returns 409 when the email is already registered', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [] } },
      error: null,
    });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('already registered');
    expect(body.code).toBe('email_already_registered');
    expect(linkAuthUserToPlayer).not.toHaveBeenCalled();
  });

  it('creates the auth user and links it to the player', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [{ id: 'i-1' }] } },
      error: null,
    });
    vi.mocked(linkAuthUserToPlayer).mockResolvedValue({ ...mockPlayer, auth_user_id: 'auth-1' });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(signUp).toHaveBeenCalledWith({
      email: 'ash@example.com',
      password: 'pikachu123',
      options: { data: { display_name: 'Ash', locale: 'en' } },
    });
    expect(linkAuthUserToPlayer).toHaveBeenCalledWith('player-1', 'auth-1');
  });

  it('stores the UI language from plc_locale so the confirmation email is German', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [{ id: 'i-1' }] } },
      error: null,
    });
    vi.mocked(linkAuthUserToPlayer).mockResolvedValue({ ...mockPlayer, auth_user_id: 'auth-1' });

    await POST(makeRequest(VALID_BODY, 'plc_locale=de'));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { data: { display_name: 'Ash', locale: 'de' } } })
    );
  });

  it('returns 400 email_login_create_failed on GoTrue client errors', async () => {
    signUp.mockResolvedValue({ data: { user: null }, error: { status: 422, message: 'internal detail' } });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('email_login_create_failed');
    expect(body.error).not.toContain('internal detail');
  });

  it('returns 400 on invalid body', async () => {
    const res = await POST(makeRequest({ email: 'bad', password: 'pikachu123' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(signUp).not.toHaveBeenCalled();
  });
});
