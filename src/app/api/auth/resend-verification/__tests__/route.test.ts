import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const resend = vi.fn();

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { resend } }),
}));

import { POST } from '@/app/api/auth/resend-verification/route';
import { rateLimitKey } from '@/lib/utils/rate-limit';
import { AUTH_RATE_LIMITS } from '@/lib/auth/rate-limits';

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body), headers: new Headers() } as unknown as NextRequest;
}

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
  });

  it('answers an invalid email with validation_failed and the issues as its param', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(resend).not.toHaveBeenCalled();
  });

  it('returns the generic success even when GoTrue fails (no enumeration)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resend.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', message: 'slow down' } });

    const res = await POST(makeRequest({ email: 'ash@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('answers an unexpected failure with the verification_resend_failed fallback code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resend.mockRejectedValue(new Error('network down'));

    const res = await POST(makeRequest({ email: 'ash@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      error: 'Failed to resend verification email',
      code: 'verification_resend_failed',
    });
  });
});

describe('POST /api/auth/resend-verification rate limit (Postgres store, H8)', () => {
  const DENIED = { data: [{ allowed: false, hits: 99, retry_after_seconds: 600 }], error: null };

  function requestFrom(ip: string, body: unknown): NextRequest {
    return {
      json: vi.fn().mockResolvedValue(body),
      headers: new Headers({ 'x-forwarded-for': `6.6.6.6, ${ip}` }),
    } as unknown as NextRequest;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
  });

  it('counts the attempt per client IP and per normalized email with the configured limits', async () => {
    resend.mockResolvedValue({ error: null });

    await POST(requestFrom('203.0.113.9', { email: 'Ash@Example.com' }));

    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('resend-verification-ip', '203.0.113.9'),
      p_window_seconds: AUTH_RATE_LIMITS['resend-verification'].ip.windowSeconds,
      p_max: AUTH_RATE_LIMITS['resend-verification'].ip.limit,
    });
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('resend-verification-email', 'ash@example.com'),
      p_window_seconds: AUTH_RATE_LIMITS['resend-verification'].email!.windowSeconds,
      p_max: AUTH_RATE_LIMITS['resend-verification'].email!.limit,
    });
  });

  it('answers 429 rate_limited with Retry-After and never reaches GoTrue when the IP is over the limit', async () => {
    rpc.mockResolvedValueOnce(DENIED);

    const res = await POST(requestFrom('203.0.113.9', { email: 'Ash@Example.com' }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(json).toEqual({
      success: false,
      error: 'Rate limit exceeded. Try again in 600s.',
      code: 'rate_limited',
      params: { seconds: 600 },
    });
    expect(resend).not.toHaveBeenCalled();
  });

  it('answers 429 when the email is over its own limit from a fresh IP', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null }).mockResolvedValueOnce(DENIED);

    const res = await POST(requestFrom('198.51.100.20', { email: 'Ash@Example.com' }));

    expect(res.status).toBe(429);
    expect(resend).not.toHaveBeenCalled();
  });

  it('fails closed with 503 rate_limit_unavailable when the limiter is down (sends email to any address)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    resend.mockResolvedValue({ error: null });

    const res = await POST(requestFrom('203.0.113.9', { email: 'Ash@Example.com' }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json).toMatchObject({ success: false, code: 'rate_limit_unavailable' });
    expect(resend).not.toHaveBeenCalled();
    // The outage is logged, without the address.
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('ash@example.com');
    errorSpy.mockRestore();
  });

  it('fails closed when the limiter RPC rejects (network failure)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValue(new Error('fetch failed'));

    const res = await POST(requestFrom('203.0.113.9', { email: 'Ash@Example.com' }));

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('rate_limit_unavailable');
    expect(resend).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('POST /api/auth/resend-verification - malformed JSON', () => {
  it('answers 400 invalid_json (not validation_failed) and never reaches the limiter or GoTrue', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockClear();
    resend.mockClear();
    const req = {
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token } in JSON')),
      headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(rpc).not.toHaveBeenCalled();
    expect(resend).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
