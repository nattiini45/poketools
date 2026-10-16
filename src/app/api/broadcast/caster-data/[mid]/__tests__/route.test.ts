import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    requireCreator: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/broadcast/caster-data', () => ({
  fetchCasterData: vi.fn(),
}));

import { GET } from '@/app/api/broadcast/caster-data/[mid]/route';
import { requireCreator, AuthError } from '@/lib/auth/helpers';
import { fetchCasterData } from '@/lib/broadcast/caster-data';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockPlayer = { playerId: 'creator-1', isAdmin: false, isCreator: true };
const routeParams = { params: Promise.resolve({ mid: 'match-1' }) };

const mockCasterData = {
  match: { id: 'match-1', status: 'in_progress' },
  player1: { name: 'Alice', rating: 1500 },
  player2: { name: 'Bob', rating: 1450 },
  h2h: { player1_wins: 2, player2_wins: 1 },
};

describe('GET /api/broadcast/caster-data/[mid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns caster data for a match', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(fetchCasterData).mockResolvedValue(mockCasterData as never);

    const request = {} as NextRequest;
    const res = await GET(request, routeParams);
    const body = await res.json();

    expect(body).toEqual(mockCasterData);
    expect(fetchCasterData).toHaveBeenCalledWith('match-1');
    expect(res.headers.get('Cache-Control')).toBe(
      's-maxage=30, stale-while-revalidate=60'
    );
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(fetchCasterData).mockResolvedValue(null);

    const request = {} as NextRequest;
    const res = await GET(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
  });

  it('delegates to safeErrorResponse when not creator', async () => {
    vi.mocked(requireCreator).mockRejectedValue(
      new AuthError('Creator access required', 403)
    );

    const request = {} as NextRequest;
    await GET(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('delegates to safeErrorResponse on unexpected error', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(fetchCasterData).mockRejectedValue(new Error('DB error'));

    const request = {} as NextRequest;
    await GET(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
