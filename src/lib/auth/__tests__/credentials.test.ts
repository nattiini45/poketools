import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signInWithPassword, rpc } = vi.hoisted(() => ({ signInWithPassword: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({
    auth: { signInWithPassword },
  }),
}));

import {
  authorizeCredentials,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  TooManySignInAttemptsError,
} from '../credentials';
import { rateLimitKey } from '@/lib/utils/rate-limit';
import { AUTH_RATE_LIMITS } from '@/lib/auth/rate-limits';
import { FIELD_LIMITS } from '@/lib/validation/schemas';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authorizeCredentials', () => {
  it('returns the auth user on success', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          user_metadata: { display_name: 'Ash' },
        },
      },
      error: null,
    });

    const user = await authorizeCredentials('Ash@Example.com ', 'hunter22');

    expect(user).toEqual({ id: 'auth-user-1', email: 'ash@example.com', displayName: 'Ash' });
    // Email is normalized before hitting GoTrue
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ash@example.com',
      password: 'hunter22',
    });
  });

  it('falls back to the email local part when display_name is missing', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: 'auth-user-1', user_metadata: {} } },
      error: null,
    });

    const user = await authorizeCredentials('misty@example.com', 'hunter22');
    expect(user.displayName).toBe('misty');
  });

  // GoTrue's own /auth/v1/signup is reachable with the public anon key, so
  // `display_name` arrives without the app's signup schema ever having seen it.
  describe('display_name from GoTrue metadata', () => {
    const signInWith = (user_metadata: Record<string, unknown>) => {
      signInWithPassword.mockResolvedValue({
        data: { user: { id: 'auth-user-1', user_metadata } },
        error: null,
      });
      return authorizeCredentials('misty@example.com', 'hunter22');
    };

    it('truncates an over-long name to the name limit', async () => {
      const user = await signInWith({ display_name: 'x'.repeat(500) });
      expect(user.displayName).toBe('x'.repeat(FIELD_LIMITS.NAME));
    });

    it('strips control characters and collapses whitespace', async () => {
      const user = await signInWith({ display_name: '  A\u0000s\u0007h\n\t  Ketchum' });
      expect(user.displayName).toBe('Ash Ketchum');
    });

    it('falls back to the email local part for a whitespace-only or control-only name', async () => {
      expect((await signInWith({ display_name: ' \t\n ' })).displayName).toBe('misty');
      expect((await signInWith({ display_name: '\u0000\u0001' })).displayName).toBe('misty');
    });

    it('ignores a non-string display_name', async () => {
      expect((await signInWith({ display_name: { evil: true } })).displayName).toBe('misty');
    });

    it('keeps a valid name exactly, emoji and accents included', async () => {
      expect((await signInWith({ display_name: 'Zoë 🔥 Müller' })).displayName).toBe('Zoë 🔥 Müller');
    });

    it('never cuts a surrogate pair in half when truncating', async () => {
      const user = await signInWith({ display_name: '🔥'.repeat(FIELD_LIMITS.NAME + 5) });
      expect(Array.from(user.displayName)).toHaveLength(FIELD_LIMITS.NAME);
      expect(user.displayName).toBe('🔥'.repeat(FIELD_LIMITS.NAME));
    });
  });

  it('throws EmailNotVerifiedError when the email is not confirmed', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });

    await expect(authorizeCredentials('ash@example.com', 'hunter22'))
      .rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it('throws InvalidCredentialsError on any other GoTrue error', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    await expect(authorizeCredentials('ash@example.com', 'wrong'))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects empty email or password without calling GoTrue', async () => {
    await expect(authorizeCredentials('', 'hunter22'))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(authorizeCredentials('ash@example.com', ''))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('authorizeCredentials rate limit (H8)', () => {
  const ALLOWED = { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null };
  const DENIED = { data: [{ allowed: false, hits: 31, retry_after_seconds: 120 }], error: null };
  const request = { headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }) };

  beforeEach(() => {
    rpc.mockResolvedValue(ALLOWED);
    signInWithPassword.mockResolvedValue({
      data: { user: { id: 'auth-user-1', user_metadata: {} } },
      error: null,
    });
  });

  it('counts the attempt per client IP only (no per-email lockout bucket) before GoTrue', async () => {
    await authorizeCredentials(' Ash@Example.com', 'hunter22', request);

    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('signin-ip', '203.0.113.9'),
      p_window_seconds: AUTH_RATE_LIMITS.signin.ip.windowSeconds,
      p_max: AUTH_RATE_LIMITS.signin.ip.limit,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(AUTH_RATE_LIMITS.signin.email).toBeUndefined();
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('throws TooManySignInAttemptsError (code too_many_attempts) and never asks GoTrue once denied', async () => {
    rpc.mockResolvedValueOnce(DENIED);

    const attempt = authorizeCredentials('ash@example.com', 'hunter22', request);

    await expect(attempt).rejects.toBeInstanceOf(TooManySignInAttemptsError);
    await expect(attempt).rejects.toMatchObject({ code: 'too_many_attempts' });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('fails open: a limiter outage is logged and sign-in still works', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const user = await authorizeCredentials('ash@example.com', 'hunter22', request);

    expect(user.id).toBe('auth-user-1');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not touch the limiter for an empty email or password', async () => {
    await expect(authorizeCredentials('', 'hunter22', request)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
