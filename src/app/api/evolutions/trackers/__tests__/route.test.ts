import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requireAuth: vi.fn(), AuthError };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn().mockImplementation((_err: unknown, msg: string) =>
    NextResponse.json({ success: false, error: msg }, { status: 500 }),
  ),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getPlayerTrackersWithTiers: vi.fn(),
}));

import { GET } from '../route';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonTrackers, getPlayerTrackersWithTiers } from '@/lib/supabase/queries/evolutions';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockGetSeasonTrackers = getSeasonTrackers as ReturnType<typeof vi.fn>;
const mockGetPlayerTrackers = getPlayerTrackersWithTiers as ReturnType<typeof vi.fn>;
const mockSafeError = safeErrorResponse as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/evolutions/trackers');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/evolutions/trackers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u-1' });
  });

  it('returns season trackers when no player_id', async () => {
    const trackers = [
      { id: 't-1', season_id: 's-1', base_pokemon: 'Charmander', current_stage: 1 },
    ];
    mockGetSeasonTrackers.mockResolvedValue(trackers);

    const res = await GET(makeRequest({ season_id: 's-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(trackers);
    expect(mockGetSeasonTrackers).toHaveBeenCalledWith('s-1');
  });

  it('returns player trackers with tiers when player_id given', async () => {
    const trackers = [
      { id: 't-1', base_pokemon: 'Charmander', current_kos: 4, tier: { stage2_kos: 3 } },
    ];
    mockGetPlayerTrackers.mockResolvedValue(trackers);

    const res = await GET(makeRequest({ season_id: 's-1', player_id: 'p-1' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toEqual(trackers);
    expect(mockGetPlayerTrackers).toHaveBeenCalledWith('s-1', 'p-1');
  });

  it('returns 400 when season_id is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('season_id is required');
    expect(json.code).toBe('draft_season_id_required');
  });

  it('calls safeErrorResponse on unexpected error', async () => {
    mockRequireAuth.mockRejectedValue(new Error('auth down'));

    await GET(makeRequest({ season_id: 's-1' }));

    expect(mockSafeError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to fetch evolution trackers',
    );
  });
});
