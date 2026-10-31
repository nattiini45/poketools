import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Player } from '@/types/player';

const signUp = vi.fn();
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

// The limiter's Postgres store, for the fail-closed case; the other tests use the in-memory store.
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { signUp } }),
}));

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  isReservedSuperadminEmail: vi.fn(),
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

import { LINK_EMAIL_INBOX_LIMIT, LINK_EMAIL_PLAYER_LIMIT, POST } from '@/app/api/account/link-email/route';
import { isReservedSuperadminEmail, requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById, linkAuthUserToPlayer } from '@/lib/supabase/queries/players';
import { resetMemoryRateLimits } from '@/lib/utils/rate-limit';

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
    // The limiter's in-memory store: the real counting, without a database.
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    resetMemoryRateLimits();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'player-1' } as Awaited<ReturnType<typeof requirePlayer>>);
    vi.mocked(getPlayerById).mockResolvedValue(mockPlayer);
    vi.mocked(isReservedSuperadminEmail).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SUPERADMIN_DISCORD_ID;
  });

  it('pins both limits: 5 per hour per player and 3 per hour per inbox, fail closed', () => {
    expect(LINK_EMAIL_PLAYER_LIMIT).toEqual({ limit: 5, windowSeconds: 3600, failMode: 'closed' });
    expect(LINK_EMAIL_INBOX_LIMIT).toEqual({ limit: 3, windowSeconds: 3600, failMode: 'closed' });
  });

  it('answers 503 and creates nothing when the limiter cannot be consulted', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
    rpc.mockRejectedValue(new Error('limiter down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('rate_limit_unavailable');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for a body that does not parse, and creates nothing', async () => {
    const request = { json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')), headers: new Headers() } as unknown as NextRequest;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('limits attempts per player before reading the body, and per inbox whatever the alias (#36)', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'auth-1', identities: [] } }, error: null });
    for (let i = 0; i < 3; i += 1) expect((await POST(makeRequest({ ...VALID_BODY, email: `ash+${i}@example.com` }))).status).toBe(409);
    // The fourth try at the same inbox is refused before GoTrue is asked.
    const inbox = await POST(makeRequest({ ...VALID_BODY, email: 'Ash+other@Example.com' }));
    expect(inbox.status).toBe(429);
    expect(signUp).toHaveBeenCalledTimes(3);
    // The fifth attempt of this player still counts; the sixth is refused whatever it says.
    await POST(makeRequest({ ...VALID_BODY, email: 'misty@example.com' }));
    const refused = makeRequest({ ...VALID_BODY, email: 'brock@example.com' });
    const player = await POST(refused);
    expect(player.status).toBe(429);
    expect(refused.json).not.toHaveBeenCalled();
    expect(signUp).toHaveBeenCalledTimes(4);
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

  describe('reserved SUPERADMIN_EMAIL', () => {
    const RESERVED_BODY = { email: 'boss@example.com', password: 'pikachu123' };

    beforeEach(() => {
      vi.mocked(isReservedSuperadminEmail).mockImplementation(
        (email) => email?.trim().toLowerCase() === 'boss@example.com'
      );
    });

    it('refuses a non-superadmin with the generic create-failed 400 and never calls signUp', async () => {
      process.env.SUPERADMIN_DISCORD_ID = 'superadmin-discord';

      const res = await POST(makeRequest(RESERVED_BODY));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({
        success: false,
        error: 'Could not create the email login. Check the email and password and try again.',
        code: 'email_login_create_failed',
      });
      expect(isReservedSuperadminEmail).toHaveBeenCalledWith('boss@example.com');
      expect(signUp).not.toHaveBeenCalled();
      expect(linkAuthUserToPlayer).not.toHaveBeenCalled();
    });

    it('refuses everyone when SUPERADMIN_DISCORD_ID is unset', async () => {
      const res = await POST(makeRequest(RESERVED_BODY));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('email_login_create_failed');
      expect(signUp).not.toHaveBeenCalled();
    });

    it('lets the Discord superadmin link the reserved address', async () => {
      process.env.SUPERADMIN_DISCORD_ID = mockPlayer.discord_id as string;
      signUp.mockResolvedValue({
        data: { user: { id: 'auth-boss', identities: [{ id: 'i-1' }] } },
        error: null,
      });
      vi.mocked(linkAuthUserToPlayer).mockResolvedValue({ ...mockPlayer, auth_user_id: 'auth-boss' });

      const res = await POST(makeRequest(RESERVED_BODY));

      expect(res.status).toBe(200);
      expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'boss@example.com' }));
      expect(linkAuthUserToPlayer).toHaveBeenCalledWith('player-1', 'auth-boss');
    });
  });
});
