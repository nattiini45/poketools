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

import { GET } from '../route';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { composeWeeklyRecap } from '@/lib/broadcast/recap-engine';
import { safeErrorResponse } from '@/lib/api/error-response';
import { resolveContentLocale } from '@/i18n/content-locale';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Test data ─────────────────────────────────────────────────────────

const mockSeason = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Season One' };
const mockTournament = { id: '22222222-2222-4222-8222-222222222222', name: 'Round Robin' };
const mockRound = { id: '33333333-3333-4333-8333-333333333333', name: 'Week 1', round_number: 1 };
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
