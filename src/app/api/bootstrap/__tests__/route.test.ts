import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// Save original env
const originalEnv = { ...process.env };

const { adminLimit, rpc, checkRateLimit, logAuditEvent } = vi.hoisted(() => ({
  adminLimit: vi.fn(),
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  loadSessionPlayer: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) =>
    NextResponse.json({ success: false, error: fallback }, { status: 500 })
  ),
}));

const from = vi.fn(() => ({
  select: vi.fn(() => ({ eq: vi.fn(() => ({ limit: adminLimit })) })),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [])), rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock('@/lib/utils/rate-limit', async () => {
  const { NextResponse: Res } = await import('next/server');
  return {
    checkRateLimit,
    getClientIp: vi.fn(() => '203.0.113.9'),
    rateLimitedResponse: (seconds: number) =>
      Res.json(
        { success: false, error: `Rate limit exceeded. Try again in ${seconds}s.`, code: 'rate_limited', params: { seconds } },
        { status: 429, headers: { 'Retry-After': String(seconds) } }
      ),
  };
});

vi.mock('@/lib/audit/log', () => ({ logAuditEvent }));

import { POST } from '@/app/api/bootstrap/route';
import { auth, loadSessionPlayer } from '@/auth';
import { safeErrorResponse } from '@/lib/api/error-response';

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  } as unknown as NextRequest;
}

const SECRET = 'test-secret-123';
const PLAYER = { playerId: 'player-1', name: 'TestAdmin' };

function signedIn(provider: 'discord' | 'credentials' = 'discord', id = 'discord-123') {
  vi.mocked(auth).mockResolvedValue({ user: { id, name: 'TestAdmin' }, provider } as unknown as Awaited<ReturnType<typeof auth>>);
  vi.mocked(loadSessionPlayer).mockResolvedValue(PLAYER as never);
}

describe('POST /api/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, BOOTSTRAP_SECRET: SECRET };
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
    adminLimit.mockResolvedValue({ data: [], error: null }); // no admin yet
    rpc.mockResolvedValue({ data: 'promoted', error: null });
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns 500 (logged) when BOOTSTRAP_SECRET is not configured', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.BOOTSTRAP_SECRET;

    const res = await POST(makeRequest({ secret: 'anything' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('BOOTSTRAP_SECRET not configured');
    expect(body.code).toBe('bootstrap_not_configured');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns 400 when secret is missing or oversized', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('secret');
    expect(body.code).toBe('validation_failed');

    const long = await POST(makeRequest({ secret: 'x'.repeat(513) }));
    expect(long.status).toBe(400);
  });

  it('never sleeps: no fixed delay on any path', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await POST(makeRequest({ secret: 'wrong-secret' }));
    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });

  it('caps attempts per client IP with the rate limiter (429 before any secret check)', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 700 });

    const res = await POST(makeRequest({ secret: SECRET }));

    expect(checkRateLimit).toHaveBeenCalledWith('bootstrap', '203.0.113.9', { limit: 5, windowSeconds: 900 });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('rate_limited');
    expect(adminLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the secret is wrong (no session read, no promotion)', async () => {
    const res = await POST(makeRequest({ secret: 'wrong-secret' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Invalid or missing bootstrap secret');
    expect(body.code).toBe('bootstrap_secret_invalid');
    expect(auth).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('once an admin exists, answers bootstrap_admin_exists for right AND wrong secrets (no secret oracle)', async () => {
    adminLimit.mockResolvedValue({ data: [{ id: 'admin-1' }], error: null });

    const right = await POST(makeRequest({ secret: SECRET }));
    const wrong = await POST(makeRequest({ secret: 'wrong-secret' }));
    const rightBody = await right.json();
    const wrongBody = await wrong.json();

    expect(right.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(rightBody).toEqual(wrongBody);
    expect(rightBody.code).toBe('bootstrap_admin_exists');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('eligibility is "no admin exists", not "no players exist": other players do not block it', async () => {
    signedIn();
    // The admin query filters on is_admin; non-admin players (incl. the caller's own row) are not returned.
    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('players');
  });

  it('returns 401 when not signed in', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('signed in');
    expect(body.code).toBe('bootstrap_sign_in_required');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 409 bootstrap_player_missing when the signed-in identity has no player row', async () => {
    signedIn();
    vi.mocked(loadSessionPlayer).mockResolvedValue(null);

    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('bootstrap_player_missing');
    expect(rpc).not.toHaveBeenCalled();
  });

  it("promotes the caller's existing player row atomically and audits it", async () => {
    signedIn();

    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.playerId).toBe('player-1');
    expect(body.data.message).toContain('TestAdmin');
    expect(loadSessionPlayer).toHaveBeenCalledWith('discord', 'discord-123');
    expect(rpc).toHaveBeenCalledWith('bootstrap_first_admin', { p_player_id: 'player-1' });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'player.role.assign', resource_id: 'player-1', metadata: { via: 'bootstrap' } })
    );
  });

  it('resolves email/password sessions through the credentials identity', async () => {
    signedIn('credentials', 'auth-user-uuid-1');

    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(200);
    expect(loadSessionPlayer).toHaveBeenCalledWith('credentials', 'auth-user-uuid-1');
  });

  it('returns 403 bootstrap_admin_exists when a concurrent bootstrap won the race', async () => {
    signedIn();
    rpc.mockResolvedValue({ data: 'admin_exists', error: null });

    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('bootstrap_admin_exists');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns 409 when the row vanished between the read and the promotion', async () => {
    signedIn();
    rpc.mockResolvedValue({ data: 'player_not_found', error: null });

    const res = await POST(makeRequest({ secret: SECRET }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('bootstrap_player_missing');
  });

  it('surfaces database and unexpected RPC failures as 500 through safeErrorResponse', async () => {
    adminLimit.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    expect((await POST(makeRequest({ secret: SECRET }))).status).toBe(500);

    signedIn();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
    expect((await POST(makeRequest({ secret: SECRET }))).status).toBe(500);

    rpc.mockResolvedValueOnce({ data: 'something-else', error: null });
    expect((await POST(makeRequest({ secret: SECRET }))).status).toBe(500);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/bootstrap - malformed JSON', () => {
  it('routes an unparsable body to invalid_json (400) before the limiter, the secret or the database', async () => {
    checkRateLimit.mockClear();
    rpc.mockClear();
    vi.mocked(safeErrorResponse).mockClear();
    const parseError = new SyntaxError('Unexpected end of JSON input');
    const req = {
      json: vi.fn().mockRejectedValue(parseError),
      headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    } as unknown as NextRequest;

    await POST(req);

    expect(safeErrorResponse).toHaveBeenCalledWith(parseError, 'Invalid JSON body', 400, 'invalid_json');
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
