import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/format-engine/shadow', () => ({ loadShadowDiff: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitedResponse: vi.fn(
    (seconds: number) =>
      new Response(JSON.stringify({ success: false, code: 'rate_limited', params: { seconds } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  ),
}));

import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { loadShadowDiff, type ShadowDiffReport } from '@/lib/format-engine/shadow';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import { GET } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const params = { params: Promise.resolve({ id: SEASON_ID }) };
const request = () => new Request(`http://localhost/api/seasons/${SEASON_ID}/format/shadow`);

const report: ShadowDiffReport = {
  engine: 'shadow',
  phases: [
    {
      phase_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
      phase_name: 'League',
      stage_key: 'league',
      completed_matches: 3,
      rows: [{ player_id: 'p1', player_name: 'Ash', legacy_rank: 2, kit_rank: 1, legacy_points: 3, kit_points: 31 }],
    },
  ],
  season: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'x', name: 'Admin' } as SessionPlayer);
  vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'custom' } as Season);
  vi.mocked(loadShadowDiff).mockResolvedValue(report);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 } as never);
});

describe('GET /api/seasons/[id]/format/shadow', () => {
  it('returns the diff to a league admin, with public player fields only', async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(report);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID);
    expectNoPrivatePlayerData(body);
  });

  it('limits the reads per admin and answers 429 before reading the league', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 120 } as never);

    const response = await GET(request(), params);

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith('format-shadow', 'x', { limit: 60, windowSeconds: 3600 });
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(loadShadowDiff).not.toHaveBeenCalled();
  });

  it('answers 403 to an admin of another league before reading the league', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await GET(request(), params)).status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(loadShadowDiff).not.toHaveBeenCalled();
  });

  it('answers 404 format_nothing_attached without a format or for another league type', async () => {
    vi.mocked(loadShadowDiff).mockResolvedValue(null);
    const none = await GET(request(), params);
    expect(none.status).toBe(404);
    expect((await none.json()).code).toBe('format_nothing_attached');

    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'singles' } as Season);
    const other = await GET(request(), params);
    expect(other.status).toBe(404);
    expect((await other.json()).code).toBe('format_nothing_attached');
  });
});
