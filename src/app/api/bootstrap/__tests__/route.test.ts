import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// Save original env
const originalEnv = { ...process.env };

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

// Build a configurable Supabase mock
const mockSelectHead = vi.fn();
const mockInsertSingle = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockImplementation(() => mockSelectHead()),
      insert: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockImplementation(() => mockInsertSingle()),
        }),
      })),
    })),
  },
}));

import { POST } from '@/app/api/bootstrap/route';
import { auth } from '@/auth';

// Stub the route's 1s constant-time delay so tests aren't slow. Installed per
// test rather than at module scope: hijacking globalThis.setTimeout BEFORE the
// imports above run makes vitest's own module-loading timers re-enter
// synchronously, which throws "Cannot access 'timer' before initialization"
// under vitest >= 4.1.11.
function stubConstantTimeDelay(): void {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0;
  }) as typeof setTimeout);
}

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('POST /api/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubConstantTimeDelay();
    process.env = { ...originalEnv, BOOTSTRAP_SECRET: 'test-secret-123' };

    // Default: no players exist
    mockSelectHead.mockResolvedValue({ count: 0, error: null });
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns 500 when BOOTSTRAP_SECRET is not configured', async () => {
    delete process.env.BOOTSTRAP_SECRET;

    const res = await POST(makeRequest({ secret: 'anything' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('BOOTSTRAP_SECRET not configured');
    expect(body.code).toBe('bootstrap_not_configured');
  });

  it('returns 400 when secret is missing from body', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('secret');
    expect(body.code).toBe('validation_failed');
  });

  it('returns 403 when secret is wrong', async () => {
    const res = await POST(makeRequest({ secret: 'wrong-secret' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Invalid or missing bootstrap secret');
    expect(body.code).toBe('bootstrap_secret_invalid');
  });

  it('returns 403 when players already exist', async () => {
    mockSelectHead.mockResolvedValue({ count: 5, error: null });

    const res = await POST(makeRequest({ secret: 'test-secret-123' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('players already exist');
    expect(body.code).toBe('bootstrap_disabled');
  });

  it('returns 401 when not signed in', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await POST(makeRequest({ secret: 'test-secret-123' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('signed in');
    expect(body.code).toBe('bootstrap_sign_in_required');
  });

  it('creates first admin player on success', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'discord-123', name: 'TestAdmin' },
    } as unknown as Awaited<ReturnType<typeof auth>>);

    mockInsertSingle.mockResolvedValue({
      data: { id: 'player-1' },
      error: null,
    });

    const res = await POST(makeRequest({ secret: 'test-secret-123' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.playerId).toBe('player-1');
    expect(body.data.message).toContain('TestAdmin');
  });

  it('creates first admin via auth_user_id for email/password sessions', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'auth-user-uuid-1', name: 'EmailAdmin' },
      provider: 'credentials',
    } as unknown as Awaited<ReturnType<typeof auth>>);

    mockInsertSingle.mockResolvedValue({
      data: { id: 'player-1' },
      error: null,
    });

    const res = await POST(makeRequest({ secret: 'test-secret-123' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.playerId).toBe('player-1');
  });
});
