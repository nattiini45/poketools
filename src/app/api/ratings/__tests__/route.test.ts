import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RatingLeaderboardEntry } from '@/types/rating';

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getLeaderboardEntries: vi.fn(),
}));

import { GET } from '@/app/api/ratings/route';
import { getLeaderboardEntries } from '@/lib/supabase/queries/ratings';

const mockEntry: RatingLeaderboardEntry = {
  id: 'rating-1',
  player_id: 'player-1',
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  peak_rating: 1500,
  peak_date: null,
  wins: 7,
  losses: 3,
  draws: 0,
  last_match_at: null,
  player_name: 'Ash',
  player_avatar_url: null,
  signatures: [],
};

describe('GET /api/ratings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns leaderboard without min_games (public, no auth)', async () => {
    vi.mocked(getLeaderboardEntries).mockResolvedValue([mockEntry]);

    const url = new URL('http://localhost:3000/api/ratings');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockEntry]);
    expect(vi.mocked(getLeaderboardEntries)).toHaveBeenCalledWith(undefined);
  });

  it('passes valid min_games param', async () => {
    vi.mocked(getLeaderboardEntries).mockResolvedValue([mockEntry]);

    const url = new URL('http://localhost:3000/api/ratings?min_games=5');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(getLeaderboardEntries)).toHaveBeenCalledWith(5);
  });

  it('ignores invalid min_games param', async () => {
    vi.mocked(getLeaderboardEntries).mockResolvedValue([mockEntry]);

    const url = new URL('http://localhost:3000/api/ratings?min_games=abc');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(vi.mocked(getLeaderboardEntries)).toHaveBeenCalledWith(undefined);
  });

  it('ignores negative min_games param', async () => {
    vi.mocked(getLeaderboardEntries).mockResolvedValue([mockEntry]);

    const url = new URL('http://localhost:3000/api/ratings?min_games=-5');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(vi.mocked(getLeaderboardEntries)).toHaveBeenCalledWith(undefined);
  });

  it('accepts min_games=0', async () => {
    vi.mocked(getLeaderboardEntries).mockResolvedValue([]);

    const url = new URL('http://localhost:3000/api/ratings?min_games=0');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(vi.mocked(getLeaderboardEntries)).toHaveBeenCalledWith(0);
  });

  it('sets Cache-Control header', async () => {
    vi.mocked(getLeaderboardEntries).mockResolvedValue([]);

    const url = new URL('http://localhost:3000/api/ratings');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=60',
    );
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getLeaderboardEntries).mockRejectedValue(new Error('DB error'));

    const url = new URL('http://localhost:3000/api/ratings');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch rating leaderboard');
  });
});
