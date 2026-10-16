import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  setPlayerWorldExperience: vi.fn(),
}));

import { PATCH } from '@/app/api/account/world-experience/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { setPlayerWorldExperience } from '@/lib/supabase/queries/players';

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function makeBadJsonRequest(): NextRequest {
  return {
    json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
  } as unknown as NextRequest;
}

describe('PATCH /api/account/world-experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'player-1',
    } as Awaited<ReturnType<typeof requirePlayer>>);
    vi.mocked(setPlayerWorldExperience).mockResolvedValue(undefined);
  });

  it('returns 401 for an unauthenticated caller and writes nothing', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Not authenticated', 401));

    const res = await PATCH(makeRequest({ worldExperience: 'on' }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('returns 400 with a distinct message on an invalid enum value', async () => {
    const res = await PATCH(makeRequest({ worldExperience: 'turbo' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    if (!body.success) {
      expect(body.error).toContain("'auto', 'on' or 'off'");
      expect(body.code).toBe('world_experience_invalid');
    }
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('returns 400 when worldExperience is missing', async () => {
    const res = await PATCH(makeRequest({}));
    expect(res.status).toBe(400);
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-JSON body', async () => {
    const res = await PATCH(makeBadJsonRequest());
    expect(res.status).toBe(400);
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) on a literal null JSON body', async () => {
    // `JSON.parse('null')` resolves successfully — the malformed-body path
    // must still yield the distinct enum message, never a TypeError 500.
    const res = await PATCH(makeRequest(null));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    if (!body.success) {
      expect(body.error).toContain("'auto', 'on' or 'off'");
    }
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('returns 400 on an array body', async () => {
    const res = await PATCH(makeRequest(['on']));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    if (!body.success) {
      expect(body.error).toContain("'auto', 'on' or 'off'");
    }
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('returns 400 on a nested-object worldExperience value', async () => {
    const res = await PATCH(makeRequest({ worldExperience: { value: 'on' } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    if (!body.success) {
      expect(body.error).toContain("'auto', 'on' or 'off'");
    }
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it('rejects non-string worldExperience values', async () => {
    for (const bad of [true, 1, null, ['on'], { value: 'on' }]) {
      const res = await PATCH(makeRequest({ worldExperience: bad }));
      expect(res.status).toBe(400);
    }
    expect(setPlayerWorldExperience).not.toHaveBeenCalled();
  });

  it("updates only the authenticated player's own row and echoes the stored value", async () => {
    const res = await PATCH(makeRequest({ worldExperience: 'on' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    if (body.success) {
      expect(body.data.worldExperience).toBe('on');
    }
    expect(setPlayerWorldExperience).toHaveBeenCalledTimes(1);
    expect(setPlayerWorldExperience).toHaveBeenCalledWith('player-1', 'on');
  });

  it('accepts every valid enum value', async () => {
    for (const value of ['auto', 'on', 'off'] as const) {
      const res = await PATCH(makeRequest({ worldExperience: value }));
      expect(res.status).toBe(200);
      expect(setPlayerWorldExperience).toHaveBeenLastCalledWith('player-1', value);
    }
  });

  it('returns 500 through safeErrorResponse when the write throws', async () => {
    vi.mocked(setPlayerWorldExperience).mockRejectedValue(new Error('db down'));

    const res = await PATCH(makeRequest({ worldExperience: 'off' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    if (!body.success) {
      // Static fallback — the internal message must not leak.
      expect(body.error).not.toContain('db down');
      expect(body.code).toBe('world_experience_save_failed');
    }
  });
});
