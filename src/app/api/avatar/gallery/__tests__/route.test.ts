import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string, status = 500, code?: string) =>
    NextResponse.json({ success: false, error: fallback, code }, { status })),
}));

vi.mock('@/lib/supabase/queries/avatar-gallery', () => ({
  getPlayerGallery: vi.fn(),
  getCommunityAvatars: vi.fn(),
}));

import { GET } from '@/app/api/avatar/gallery/route';
import { requireAuth } from '@/lib/auth/helpers';
import {
  getPlayerGallery,
  getCommunityAvatars,
} from '@/lib/supabase/queries/avatar-gallery';

const SESSION_WITH_PLAYER = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1' },
  player: { playerId: 'p1' },
};

const SESSION_NO_PLAYER = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1' },
  player: null,
};

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/avatar/gallery');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/avatar/gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when player is not registered', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_NO_PLAYER);

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Player registration required');
    expect(body.code).toBe('player_registration_required');
  });

  it('returns personal gallery by default', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    const items = [{ id: 'g1', image_url: 'https://example.com/img.png', player_id: 'p1', choices: {}, style: 'anime', created_at: '2026-01-01T00:00:00.000Z' }];
    vi.mocked(getPlayerGallery).mockResolvedValue(items as never);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual(items);
    expect(vi.mocked(getPlayerGallery)).toHaveBeenCalledWith('p1');
    expect(vi.mocked(getCommunityAvatars)).not.toHaveBeenCalled();
  });

  it('returns community gallery when scope=community', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    const items = [{ id: 'g2', image_url: 'https://example.com/community.png', player_id: 'p2', choices: {}, style: 'anime', created_at: '2026-01-01T00:00:00.000Z' }];
    vi.mocked(getCommunityAvatars).mockResolvedValue(items as never);

    const res = await GET(makeRequest({ scope: 'community' }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual(items);
    expect(vi.mocked(getCommunityAvatars)).toHaveBeenCalledWith('p1');
  });

  it('returns safeErrorResponse on unexpected error', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('boom'));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch gallery');
  });
});
