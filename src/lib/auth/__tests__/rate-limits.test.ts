import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { AUTH_RATE_LIMITS, checkAuthRateLimit } from '../rate-limits';
import { rateLimitKey } from '@/lib/utils/rate-limit';

function request(headers: Record<string, string>): Pick<Request, 'headers'> {
  return { headers: new Headers(headers) };
}

function keysHit(): string[] {
  return rpc.mock.calls.map((call) => (call[1] as { p_key: string }).p_key);
}

describe('checkAuthRateLimit', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('checks the client IP, then the normalized email', async () => {
    const result = await checkAuthRateLimit('signup', request({ 'x-forwarded-for': '203.0.113.9' }), ' Ash@Example.com ');

    expect(result).toBeNull();
    expect(keysHit()).toEqual([rateLimitKey('signup-ip', '203.0.113.9'), rateLimitKey('signup-email', 'ash@example.com')]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns the first denial and does not count later checks', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 11, retry_after_seconds: 99 }], error: null });

    const result = await checkAuthRateLimit('forgot-password', request({ 'x-real-ip': '198.51.100.2' }), 'a@b.co');

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 99 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['signup', 'forgot-password', 'resend-verification'] as const)(
    '%s sends email to any address, so both of its checks fail closed',
    (action) => {
      expect(AUTH_RATE_LIMITS[action].ip.failMode).toBe('closed');
      expect(AUTH_RATE_LIMITS[action].email?.failMode).toBe('closed');
    },
  );

  it.each(['reset-password', 'confirm-email', 'signin'] as const)('%s fails open (sends no email)', (action) => {
    expect(AUTH_RATE_LIMITS[action].ip.failMode ?? 'open').toBe('open');
    expect(AUTH_RATE_LIMITS[action].email).toBeUndefined();
  });

  it.each(['signup', 'forgot-password', 'resend-verification'] as const)(
    '%s without a client IP header skips the per-IP check instead of sharing one site-wide bucket',
    async (action) => {
      expect(AUTH_RATE_LIMITS[action].ip.failMode).toBe('closed');

      await checkAuthRateLimit(action, request({}), 'ash@example.com');

      expect(keysHit()).toEqual([rateLimitKey(`${action}-email`, 'ash@example.com')]);
      expect(keysHit()).not.toContain(rateLimitKey(`${action}-ip`, 'unknown'));
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('per-IP check skipped');
      // The warning names neither the email nor any address.
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('ash@example.com');
    },
  );

  it('an action without an email limit falls back to the shared bucket, with a warning', async () => {
    await checkAuthRateLimit('reset-password', request({}));

    expect(keysHit()).toEqual([rateLimitKey('reset-password-ip', 'unknown')]);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('shared');
  });

  it('password sign-in without a client IP uses the one shared bucket (30 / 15 min), never a per-email one', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 31, retry_after_seconds: 120 }], error: null });

    const result = await checkAuthRateLimit('signin', request({}), 'ash@example.com');

    // Deliberate: the production host always sends the header, so this path is local-only; a
    // missing header must not switch the brute-force brake off, and a per-email bucket would let
    // anyone lock an account owner out (see AUTH_RATE_LIMITS.signin).
    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 120 });
    expect(keysHit()).toEqual([rateLimitKey('signin-ip', 'unknown')]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_window_seconds: 15 * 60, p_max: 30 });
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('shared');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('ash@example.com');
  });

  it('a fail-closed limiter outage still throws without a client IP (email check runs)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });

    await expect(checkAuthRateLimit('signup', request({}), 'ash@example.com')).rejects.toMatchObject({
      statusCode: 503,
      code: 'rate_limit_unavailable',
    });
    errorSpy.mockRestore();
  });
});
