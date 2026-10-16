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

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/broadcast-moments', () => ({
  getMomentsByMatch: vi.fn(),
  createMoment: vi.fn(),
}));

import { GET, POST } from '@/app/api/broadcast/moments/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  getMomentsByMatch,
  createMoment,
} from '@/lib/supabase/queries/broadcast-moments';

const UUID_MATCH = '00000000-0000-4000-8000-000000000001';

const mockMoment = {
  id: 'moment-1',
  match_id: UUID_MATCH,
  moment_type: 'highlight',
  payload: { pokemon: 'Pikachu' },
  created_by: 'player-1',
  created_at: '2024-01-01T00:00:00Z',
};

describe('GET /api/broadcast/moments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns moments for a match', async () => {
    vi.mocked(getMomentsByMatch).mockResolvedValue([mockMoment as never]);

    const url = new URL(`http://localhost:3000/api/broadcast/moments?match_id=${UUID_MATCH}`);
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: [mockMoment] });
    expect(getMomentsByMatch).toHaveBeenCalledWith(UUID_MATCH);
  });

  it('returns 400 when match_id missing', async () => {
    const url = new URL('http://localhost:3000/api/broadcast/moments');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'match_id is required', code: 'broadcast_match_id_required' });
  });

  it.each(['notauuid', '123', "x' OR '1'='1"])(
    'answers a malformed match_id (%s) with a coded 400 and never queries Postgres',
    async (bad) => {
      const url = new URL(`http://localhost:3000/api/broadcast/moments?match_id=${encodeURIComponent(bad)}`);
      const request = { nextUrl: url } as unknown as NextRequest;

      const res = await GET(request);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.code).toBe('validation_failed');
      expect(body.params.issues).toContain('match_id');
      expect(getMomentsByMatch).not.toHaveBeenCalled();
    },
  );
});

describe('POST /api/broadcast/moments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockPlayer = { playerId: 'player-1', isAdmin: false, isCreator: false };
  const mockMatch = {
    id: UUID_MATCH,
    player_1_id: 'player-1',
    player_2_id: 'player-2',
    tournament_id: 'tourn-1',
  };

  it('creates a moment as match participant', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(createMoment).mockResolvedValue(mockMoment as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        match_id: UUID_MATCH,
        moment_type: 'highlight',
        payload: { pokemon: 'Pikachu' },
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: mockMoment });
    expect(createMoment).toHaveBeenCalledWith({
      match_id: UUID_MATCH,
      moment_type: 'highlight',
      description: null,
      timestamp_ms: null,
      created_by: 'player-1',
    });
  });

  it('creates a moment as admin', async () => {
    const adminPlayer = { playerId: 'admin-1', isAdmin: true, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(createMoment).mockResolvedValue(mockMoment as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        match_id: UUID_MATCH,
        moment_type: 'highlight',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(body.success).toBe(true);
  });

  it('creates a moment as creator', async () => {
    const creatorPlayer = { playerId: 'creator-1', isAdmin: false, isCreator: true };
    vi.mocked(requirePlayer).mockResolvedValue(creatorPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(createMoment).mockResolvedValue(mockMoment as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        match_id: UUID_MATCH,
        moment_type: 'highlight',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(body.success).toBe(true);
  });

  it('returns 400 when match_id missing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ moment_type: 'highlight' }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('match_id');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 when moment_type missing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ match_id: UUID_MATCH }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('moment_type');
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        match_id: UUID_MATCH,
        moment_type: 'highlight',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
  });

  it('returns 403 when user is not participant, admin, or creator', async () => {
    const outsider = { playerId: 'outsider', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(outsider as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        match_id: UUID_MATCH,
        moment_type: 'highlight',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Not authorized to create moments for this match',
      code: 'moment_create_forbidden',
    });
  });
});
