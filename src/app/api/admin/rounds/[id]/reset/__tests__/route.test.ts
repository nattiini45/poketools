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
    requirePlayer: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => {
  const mockSingle = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle, single: mockSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return {
    supabase: { from: mockFrom },
    __mockFrom: mockFrom,
    __mockSelect: mockSelect,
    __mockEq: mockEq,
    __mockMaybeSingle: mockMaybeSingle,
  };
});

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  resetRound: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/admin/rounds/[id]/reset/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { supabase } from '@/lib/supabase/client';
import { resetRound } from '@/lib/pkmn/game-pipeline';
import { revalidateMatchPages } from '@/lib/revalidation';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockPlayer = { playerId: 'player-1', isAdmin: true, isCreator: false };
const routeParams = { params: Promise.resolve({ id: 'ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f' }) };

function setupSupabaseMock(data: unknown, error: unknown = null) {
  vi.mocked(supabase.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  } as never);
}

describe('POST /api/admin/rounds/[id]/reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets a round when user is site admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    setupSupabaseMock({ tournament_id: 'tourn-1' });
    vi.mocked(resetRound).mockResolvedValue({
      matches_reset: 4,
      total_games_deleted: 8,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.matches_reset).toBe(4);
    expect(resetRound).toHaveBeenCalledWith('ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f', 'player-1', false);
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1');
  });

  it('threads cascade: true through to resetRound', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    setupSupabaseMock({ tournament_id: 'tourn-1' });
    vi.mocked(resetRound).mockResolvedValue({
      matches_reset: 4,
      total_games_deleted: 8,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({ cascade: true }) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(resetRound).toHaveBeenCalledWith('ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f', 'player-1', true);
  });

  it('resets a round when user is resource admin', async () => {
    const nonAdmin = { playerId: 'player-2', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    setupSupabaseMock({ tournament_id: 'tourn-1' });
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    vi.mocked(resetRound).mockResolvedValue({
      matches_reset: 4,
      total_games_deleted: 8,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(isResourceAdminFor).toHaveBeenCalledWith(
      'player-2',
      'tournament',
      'tourn-1'
    );
  });

  it('returns 404 when round not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    setupSupabaseMock(null);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Round not found', code: 'round_not_found' });
  });

  it('returns 403 when user has no admin access', async () => {
    const nonAdmin = { playerId: 'player-3', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    setupSupabaseMock({ tournament_id: 'tourn-1' });
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
  });

  it('delegates to safeErrorResponse on unexpected error', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new AuthError('Not authenticated', 401)
    );

    const request = {} as NextRequest;
    await POST(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('delegates to safeErrorResponse on supabase error', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    setupSupabaseMock(null, { message: 'DB unavailable' });

    const request = {} as NextRequest;
    await POST(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
