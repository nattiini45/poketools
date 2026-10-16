import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const signUp = vi.fn();

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { signUp } }),
}));

import { POST } from '@/app/api/auth/signup/route';

// Stub the route's 500 ms constant delay so tests aren't slow. Installed per
// test rather than at module scope: hijacking globalThis.setTimeout BEFORE the
// import above runs makes vitest's own module-loading timers re-enter
// synchronously, which throws "Cannot access 'timer' before initialization"
// under vitest >= 4.1.11.
function stubConstantTimeDelay(): void {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
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
