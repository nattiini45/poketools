import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const signUp = vi.fn();

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { signUp } }),
}));

import { POST } from '@/app/api/auth/signup/route';
import { rateLimitKey } from '@/lib/utils/rate-limit';
import { AUTH_RATE_LIMITS } from '@/lib/auth/rate-limits';

// Stub the route's 500 ms constant delay so tests aren't slow. Installed per
// test rather than at module scope: hijacking globalThis.setTimeout BEFORE the
// import above runs makes vitest's own module-loading timers re-enter
// synchronously, which throws "Cannot access 'timer' before initialization"
// under vitest >= 4.1.11.
// Only the route's 500 ms delay is short-circuited; every other timer (the
// rate limiter's RPC timeout) runs for real.
const realSetTimeout = globalThis.setTimeout;
function stubConstantTimeDelay(): void {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
    if (ms !== 500) return realSetTimeout(cb, ms);
    cb();
    return 0;
  }) as typeof setTimeout);
}

function makeRequest(body: Record<string, unknown>, cookie?: string): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(cookie ? { cookie } : {}),
  } as unknown as NextRequest;
}

const VALID_BODY = {
  email: 'ash@example.com',
  password: 'pikachu123',
  display_name: 'Ash',
};

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
    stubConstantTimeDelay();
  });

  it('returns 400 on invalid email', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, email: 'not-an-email' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('returns 400 on short password', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, password: 'short' }));
    expect(res.status).toBe(400);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('returns 400 on missing display name', async () => {
    const res = await POST(makeRequest({ email: VALID_BODY.email, password: VALID_BODY.password }));
    expect(res.status).toBe(400);
  });

  it('creates the auth user with display_name and locale metadata', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [{ id: 'i-1' }] } },
      error: null,
    });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(signUp).toHaveBeenCalledWith({
      email: 'ash@example.com',
      password: 'pikachu123',
      options: { data: { display_name: 'Ash', locale: 'en' } },
    });
  });

  it('stores the UI language from plc_locale for the bilingual email templates', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [{ id: 'i-1' }] } },
      error: null,
    });

    await POST(makeRequest(VALID_BODY, 'theme=dark; plc_locale=de'));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { data: { display_name: 'Ash', locale: 'de' } } })
    );
  });

  it('falls back to en for an unknown plc_locale value', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [{ id: 'i-1' }] } },
      error: null,
    });

    await POST(makeRequest(VALID_BODY, 'plc_locale=fr'));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { data: { display_name: 'Ash', locale: 'en' } } })
    );
  });

  it('returns the same generic success when the email is already registered', async () => {
    // Supabase signals an existing email with an empty identities array
    signUp.mockResolvedValue({
      data: { user: { id: 'auth-1', identities: [] } },
      error: null,
    });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toContain('Check your inbox');
  });

  it('returns a generic 400 on GoTrue client errors without leaking details', async () => {
    signUp.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: 'weak_password', message: 'internal detail' },
    });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('signup_failed');
    expect(body.error).not.toContain('internal detail');
  });

  it('answers a GoTrue server fault with 500 and the signup_error fallback code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    signUp.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error('internal detail'), { status: 500 }),
    });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: 'Signup failed', code: 'signup_error' });
  });
});

describe('POST /api/auth/signup rate limit (H8)', () => {
  const DENIED = { data: [{ allowed: false, hits: 99, retry_after_seconds: 600 }], error: null };

  function requestFrom(ip: string, body: unknown): NextRequest {
    return {
      json: vi.fn().mockResolvedValue(body),
      headers: new Headers({ 'x-forwarded-for': `6.6.6.6, ${ip}` }),
    } as unknown as NextRequest;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stubConstantTimeDelay();
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
  });

  it('counts the attempt per client IP and per normalized email with the configured limits', async () => {
    signUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });

    await POST(requestFrom('203.0.113.9', VALID_BODY));

    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('signup-ip', '203.0.113.9'),
      p_window_seconds: AUTH_RATE_LIMITS['signup'].ip.windowSeconds,
      p_max: AUTH_RATE_LIMITS['signup'].ip.limit,
    });
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('signup-email', 'ash@example.com'),
      p_window_seconds: AUTH_RATE_LIMITS['signup'].email!.windowSeconds,
      p_max: AUTH_RATE_LIMITS['signup'].email!.limit,
    });
  });

  it('answers 429 rate_limited with Retry-After and never reaches GoTrue when the IP is over the limit', async () => {
    rpc.mockResolvedValueOnce(DENIED);

    const res = await POST(requestFrom('203.0.113.9', VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(json).toEqual({
      success: false,
      error: 'Rate limit exceeded. Try again in 600s.',
      code: 'rate_limited',
      params: { seconds: 600 },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('answers 429 when the email is over its own limit from a fresh IP', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null }).mockResolvedValueOnce(DENIED);

    const res = await POST(requestFrom('198.51.100.20', VALID_BODY));

    expect(res.status).toBe(429);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('fails closed with 503 rate_limit_unavailable when the limiter is down (email abuse surface)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const res = await POST(requestFrom('203.0.113.9', VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('rate_limit_unavailable');
    expect(signUp).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/signup - malformed JSON', () => {
  it('answers 400 invalid_json (not validation_failed) and never reaches the limiter or GoTrue', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockClear();
    signUp.mockClear();
    const req = {
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token } in JSON')),
      headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(rpc).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
