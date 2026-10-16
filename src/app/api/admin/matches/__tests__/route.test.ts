import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    requireAdmin: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/supabase/queries/matches', () => ({
  listAllMatchesWithTournament: vi.fn(),
}));

import { GET } from '@/app/api/admin/matches/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { listAllMatchesWithTournament } from '@/lib/supabase/queries/matches';

const mockMatch = {
  id: 'match-1',
  tournament_id: 'tourn-1',
  tournament_name: 'Summer League',
  round_id: 'round-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  status: 'scheduled',
  winner_id: null,
};

describe('GET /api/admin/matches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all matches without filters', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(listAllMatchesWithTournament).mockResolvedValue([mockMatch as never]);

    const url = new URL('http://localhost:3000/api/admin/matches');
    const request = { url: url.toString() } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(requireAdmin).toHaveBeenCalled();
    expect(body).toEqual({ success: true, data: [mockMatch] });
    expect(listAllMatchesWithTournament).toHaveBeenCalledWith({
      tournament_id: undefined,
      status: undefined,
    });
  });

  it('passes tournament_id and status filters', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(listAllMatchesWithTournament).mockResolvedValue([]);

    const url = new URL(
      'http://localhost:3000/api/admin/matches?tournament_id=tourn-1&status=completed'
    );
    const request = { url: url.toString() } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: [] });
    expect(listAllMatchesWithTournament).toHaveBeenCalledWith({
      tournament_id: 'tourn-1',
      status: 'completed',
    });
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const url = new URL('http://localhost:3000/api/admin/matches');
    const request = { url: url.toString() } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(listAllMatchesWithTournament).mockRejectedValue(
      new Error('DB error')
    );

    const url = new URL('http://localhost:3000/api/admin/matches');
    const request = { url: url.toString() } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to list matches' });
  });
});
