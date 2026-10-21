import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/broadcast/recap-engine', () => ({
  composeWeeklyRecap: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({
  resolveContentLocale: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

// The limiter decision is mocked; the 429 body comes from the real `rateLimitedResponse`.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29, retryAfterSeconds: 0 })),
}));

import { GET } from '../route';
import { checkPublicRateLimit } from '@/lib/utils/rate-limit';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { composeWeeklyRecap } from '@/lib/broadcast/recap-engine';
import { safeErrorResponse } from '@/lib/api/error-response';
import { resolveContentLocale } from '@/i18n/content-locale';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Test data ─────────────────────────────────────────────────────────

const mockSeason = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Season One' };
const mockTournament = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Round Robin',
  season_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const mockRound = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Week 1',
  round_number: 1,
  tournament_id: '22222222-2222-4222-8222-222222222222',
};
const validQuery = {
  tournament_id: '22222222-2222-4222-8222-222222222222',
  round_id: '33333333-3333-4333-8333-333333333333',
};
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const mockRecap = {
  matches: [],
  stat_leaders: [],
  standings_movement: [],
  pokemon_usage: [],
};

describe('GET /api/broadcast/recap/[sid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContentLocale).mockResolvedValue('de');
  });

  it('returns 400 when tournament_id is missing', async () => {
    const req = makeRequest(undefined, { round_id: '33333333-3333-4333-8333-333333333333' });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('tournament_id and round_id');
    expect(json.code).toBe('recap_params_required');
  });

  it('returns 400 when round_id is missing', async () => {
    const req = makeRequest(undefined, { tournament_id: '22222222-2222-4222-8222-222222222222' });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('tournament_id and round_id');
    expect(json.code).toBe('recap_params_required');
  });

  it('returns 404 when season is not found', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Season not found');
    expect(json.code).toBe('season_not_found');
  });

  it('returns 404 when tournament is not found', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Tournament not found');
    expect(json.code).toBe('tournament_not_found');
  });

  it('returns 404 when round is not found', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(null);

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Round not found');
    expect(json.code).toBe('round_not_found');
  });

  it('returns recap data on happy path', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);
    vi.mocked(composeWeeklyRecap).mockResolvedValue(mockRecap as never);

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(mockRecap);

    expect(composeWeeklyRecap).toHaveBeenCalledWith({
      seasonId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      leagueName: 'Season One',
      tournamentId: '22222222-2222-4222-8222-222222222222',
      tournamentName: 'Round Robin',
      roundId: '33333333-3333-4333-8333-333333333333',
      roundName: 'Week 1',
      roundNumber: 1,
      locale: 'de',
    });
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  });

  it('uses ?lang= when it is a supported locale, without reading the league language', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);
    vi.mocked(composeWeeklyRecap).mockResolvedValue(mockRecap as never);
    vi.mocked(resolveContentLocale).mockResolvedValue('en');

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
      lang: 'de',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });

    expect(res.status).toBe(200);
    expect(composeWeeklyRecap).toHaveBeenCalledWith(expect.objectContaining({ locale: 'de' }));
    expect(resolveContentLocale).not.toHaveBeenCalled();
  });

  it('falls back to the league content language when ?lang= is unsupported', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);
    vi.mocked(composeWeeklyRecap).mockResolvedValue(mockRecap as never);
    vi.mocked(resolveContentLocale).mockResolvedValue('en');

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
      lang: 'fr',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });

    expect(res.status).toBe(200);
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    expect(composeWeeklyRecap).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it('returns 404 tournament_not_found when the tournament belongs to another season', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      ...mockTournament,
      season_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);

    const res = await GET(makeRequest(undefined, validQuery), { params: makeParams({ sid: SID }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('tournament_not_found');
    expect(composeWeeklyRecap).not.toHaveBeenCalled();
  });

  it('returns 404 round_not_found when the round belongs to another tournament', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue({
      ...mockRound,
      tournament_id: '44444444-4444-4444-8444-444444444444',
    } as never);

    const res = await GET(makeRequest(undefined, validQuery), { params: makeParams({ sid: SID }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('round_not_found');
    expect(composeWeeklyRecap).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when the per-IP limit is exhausted', async () => {
    vi.mocked(checkPublicRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 42 });

    const res = await GET(makeRequest(undefined, validQuery), { params: makeParams({ sid: SID }) });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(json.code).toBe('rate_limited');
    expect(checkPublicRateLimit).toHaveBeenCalledWith('broadcast-recap', expect.anything(), { limit: 30, windowSeconds: 60 });
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(composeWeeklyRecap).not.toHaveBeenCalled();
  });

  it('sets an edge Cache-Control header on a 200', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);
    vi.mocked(composeWeeklyRecap).mockResolvedValue(mockRecap as never);

    const res = await GET(makeRequest(undefined, validQuery), { params: makeParams({ sid: SID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=30, stale-while-revalidate=60');
  });

  it('delegates to safeErrorResponse on thrown error', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('DB down'));
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);

    const req = makeRequest(undefined, {
      tournament_id: '22222222-2222-4222-8222-222222222222',
      round_id: '33333333-3333-4333-8333-333333333333',
    });
    const res = await GET(req, { params: makeParams({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
