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

const mockSeason = { id: 'season-1', name: 'Season One' };
const mockTournament = { id: 'tournament-1', name: 'Round Robin' };
const mockRound = { id: 'round-1', name: 'Week 1', round_number: 1 };
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
    const req = makeRequest(undefined, { round_id: 'round-1' });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('tournament_id and round_id');
    expect(json.code).toBe('recap_params_required');
  });

  it('returns 400 when round_id is missing', async () => {
    const req = makeRequest(undefined, { tournament_id: 'tournament-1' });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });
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
      tournament_id: 'tournament-1',
      round_id: 'round-1',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });
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
      tournament_id: 'tournament-1',
      round_id: 'round-1',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });
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
      tournament_id: 'tournament-1',
      round_id: 'round-1',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });
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
      tournament_id: 'tournament-1',
      round_id: 'round-1',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(mockRecap);

    expect(composeWeeklyRecap).toHaveBeenCalledWith({
      seasonId: 'season-1',
      leagueName: 'Season One',
      tournamentId: 'tournament-1',
      tournamentName: 'Round Robin',
      roundId: 'round-1',
      roundName: 'Week 1',
      roundNumber: 1,
      locale: 'de',
    });
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'season-1' });
  });

  it('uses ?lang= when it is a supported locale, without reading the league language', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);
    vi.mocked(composeWeeklyRecap).mockResolvedValue(mockRecap as never);
    vi.mocked(resolveContentLocale).mockResolvedValue('en');

    const req = makeRequest(undefined, {
      tournament_id: 'tournament-1',
      round_id: 'round-1',
      lang: 'de',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });

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
      tournament_id: 'tournament-1',
      round_id: 'round-1',
      lang: 'fr',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });

    expect(res.status).toBe(200);
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'season-1' });
    expect(composeWeeklyRecap).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it('delegates to safeErrorResponse on thrown error', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('DB down'));
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundById).mockResolvedValue(mockRound as never);

    const req = makeRequest(undefined, {
      tournament_id: 'tournament-1',
      round_id: 'round-1',
    });
    const res = await GET(req, { params: makeParams({ sid: 'season-1' }) });

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
