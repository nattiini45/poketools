import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const verifyOtp = vi.fn();

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { verifyOtp } }),
}));

import { POST } from '@/app/api/auth/confirm-email/route';
import { rateLimitKey } from '@/lib/utils/rate-limit';
import { AUTH_RATE_LIMITS } from '@/lib/auth/rate-limits';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body), headers: new Headers() } as unknown as NextRequest;
}

describe('POST /api/auth/confirm-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
  });

  it('returns 400 when token_hash is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('confirms the email with verifyOtp type email', async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });

    const res = await POST(makeRequest({ token_hash: 'hash-123' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'hash-123' });
  });

  it('returns 400 on an invalid or expired token', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: 'otp_expired', message: 'expired' },
    });

    const res = await POST(makeRequest({ token_hash: 'stale' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('invalid or has expired');
    expect(body.code).toBe('confirm_link_invalid');
  });
});

describe('POST /api/auth/confirm-email rate limit (H8)', () => {
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

  it('counts the attempt per client IP with the configured limits', async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });

    await POST(requestFrom('203.0.113.9', { token_hash: 'hash-123' }));

    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('confirm-email-ip', '203.0.113.9'),
      p_window_seconds: AUTH_RATE_LIMITS['confirm-email'].ip.windowSeconds,
      p_max: AUTH_RATE_LIMITS['confirm-email'].ip.limit,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('answers 429 rate_limited with Retry-After and never reaches GoTrue when the IP is over the limit', async () => {
    rpc.mockResolvedValueOnce(DENIED);

    const res = await POST(requestFrom('203.0.113.9', { token_hash: 'hash-123' }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(json).toEqual({
      success: false,
      error: 'Rate limit exceeded. Try again in 600s.',
      code: 'rate_limited',
      params: { seconds: 600 },
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('fails open when the limiter is down: the request proceeds and the outage is logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    verifyOtp.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });

    const res = await POST(requestFrom('203.0.113.9', { token_hash: 'hash-123' }));

    expect(res.status).toBe(200);
    expect(verifyOtp).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('POST /api/auth/confirm-email - malformed JSON', () => {
  it('answers 400 invalid_json (not validation_failed) and never reaches the limiter or GoTrue', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockClear();
    verifyOtp.mockClear();
    const req = {
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token } in JSON')),
      headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(rpc).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
