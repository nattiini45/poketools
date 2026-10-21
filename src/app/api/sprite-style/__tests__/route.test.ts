import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/supabase/queries/player-sprite-style', () => ({
  getPlayerSpriteStyle: vi.fn(),
  setPlayerSpriteStyle: vi.fn(),
}));

vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));

import { GET, POST } from '@/app/api/sprite-style/route';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { AuthError, getSession, requireAuth } from '@/lib/auth/helpers';
import { getPlayerSpriteStyle, setPlayerSpriteStyle } from '@/lib/supabase/queries/player-sprite-style';

const ORIGIN = 'https://poketools.test';

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/sprite-style`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function cookieLine(res: Response): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith('plc_sprite_style='));
}

type Session = Awaited<ReturnType<typeof requireAuth>>;

describe('POST /api/sprite-style', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(setPlayerSpriteStyle).mockResolvedValue(undefined);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  });

  it('anonymous: sets the httpOnly cookie for a year and stores nothing', async () => {
    const res = await POST(makeRequest({ style: 'pixel' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { style: 'pixel', persisted: false } });
    const line = cookieLine(res);
    expect(line).toMatch(/^plc_sprite_style=pixel;/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=31536000/);
    expect(line).toMatch(/SameSite=lax/i);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).not.toMatch(/Secure/);
    expect(requireAuth).not.toHaveBeenCalled();
    expect(setPlayerSpriteStyle).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('marks the cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await POST(makeRequest({ style: 'site' }));
    expect(cookieLine(res)).toMatch(/Secure/);
  });

  it('signed in: stores the choice on the live guard\'s player and sets the cookie', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: { playerId: 'player-1' } } as unknown as Session);
    const res = await POST(makeRequest({ style: 'animated' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { style: 'animated', persisted: true } });
    expect(setPlayerSpriteStyle).toHaveBeenCalledWith('player-1', 'animated');
    expect(checkRateLimit).toHaveBeenCalledWith('sprite-style', 'player-1', { limit: 30, windowSeconds: 60 });
    expect(cookieLine(res)).toMatch(/^plc_sprite_style=animated;/);
  });

  it('signed in over the per-player limit: 429 rate_limited, no write, no cookie', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: { playerId: 'player-1' } } as unknown as Session);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const res = await POST(makeRequest({ style: 'pixel' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toMatchObject({ success: false, code: 'rate_limited', params: { seconds: 42 } });
    expect(setPlayerSpriteStyle).not.toHaveBeenCalled();
    expect(cookieLine(res)).toBeUndefined();
  });

  it('signed in without a player row: cookie only', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: null } as unknown as Session);
    const res = await POST(makeRequest({ style: 'home' }));
    expect(await res.json()).toEqual({ success: true, data: { style: 'home', persisted: false } });
    expect(setPlayerSpriteStyle).not.toHaveBeenCalled();
  });

  it('a banned account is refused by the live guard: 403, no write, no cookie', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Your account has been banned', 403, 'account_banned'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ style: 'pixel' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'account_banned' });
    expect(setPlayerSpriteStyle).not.toHaveBeenCalled();
    expect(cookieLine(res)).toBeUndefined();
  });

  it('a failed column write is a 500 with its own code, and no cookie', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: { playerId: 'player-1' } } as unknown as Session);
    vi.mocked(setPlayerSpriteStyle).mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ style: 'pixel' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: 'sprite_style_save_failed', error: 'Failed to save the sprite style' });
    expect(JSON.stringify(body)).not.toContain('db down');
    expect(cookieLine(res)).toBeUndefined();
  });

  it.each([
    ['an unknown style', { style: 'gif' }],
    ['an extra key', { style: 'home', player: 'p2' }],
    ['a missing style', {}],
    ['null', null],
    ['an array', ['home']],
    ['malformed JSON', '{"style":'],
  ])('400 sprite_style_invalid for %s', async (_label, body) => {
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "style must be one of 'site', 'broadcast', 'home', 'animated' or 'pixel'.",
      code: 'sprite_style_invalid',
    });
    expect(cookieLine(res)).toBeUndefined();
  });

  it('refuses a cross-origin request (403) and logs it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ style: 'home' }, { origin: 'https://evil.test' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'sprite_style_cross_origin' });
    expect(err).toHaveBeenCalled();
    expect(cookieLine(res)).toBeUndefined();
  });

  it('accepts a same-origin request', async () => {
    const res = await POST(makeRequest({ style: 'home' }, { origin: ORIGIN }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/sprite-style', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
  });

  it('anonymous: no account value, no store read, not cacheable', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { stored: null } });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(requireAuth).not.toHaveBeenCalled();
    expect(getPlayerSpriteStyle).not.toHaveBeenCalled();
  });

  it('signed in: the value of the live guard player', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: { playerId: 'player-1' } } as unknown as Session);
    vi.mocked(getPlayerSpriteStyle).mockResolvedValue('pixel');
    const res = await GET();
    expect(await res.json()).toEqual({ success: true, data: { stored: 'pixel' } });
    expect(getPlayerSpriteStyle).toHaveBeenCalledWith('player-1');
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('signed in without a player row: null', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: null } as unknown as Session);
    expect(await (await GET()).json()).toEqual({ success: true, data: { stored: null } });
  });

  it('a banned account is refused by the live guard (403)', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Account banned', 403, 'account_banned'));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getPlayerSpriteStyle).not.toHaveBeenCalled();
  });

  it('a failed read is a 500 with its own code', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'u1' } } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: 'u1' }, player: { playerId: 'player-1' } } as unknown as Session);
    vi.mocked(getPlayerSpriteStyle).mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('sprite_style_load_failed');
    spy.mockRestore();
  });
});
