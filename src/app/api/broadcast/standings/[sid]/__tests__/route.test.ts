import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { AuthError };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getPublicSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournament: vi.fn(),
  getMatchesByTournamentIds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn() }));

vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: vi.fn() }));
vi.mock('@/lib/league-phase/standings-context', () => ({ loadNativeSeasonStandingsContext: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhasesBySeasonId: vi.fn(),
  getPublicPhaseStandingsParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPublicMatchesByPhaseIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getByeRoundsByPhaseIds: vi.fn() }));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRatingsBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignaturesBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
  getAggregatesSummary: vi.fn(),
}));

vi.mock('@/lib/tournament/season-standings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tournament/season-standings')>()),
  computeStandingsForSeason: vi.fn(),
  loadRankingContext: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/pkmn/sprite-styles', () => ({
  siteSpriteUrl: vi.fn((name: string) => `https://sprites/${name}.png`),
}));

// The limiter decision is covered in roadcast/__tests__/overlay-limits.test.ts.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 })),
}));

import { GET } from '@/app/api/broadcast/standings/[sid]/route';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { loadNativeSeasonStandingsContext } from '@/lib/league-phase/standings-context';
import { getPhasesBySeasonId, getPublicPhaseStandingsParticipants } from '@/lib/supabase/queries/league-phases';
import { getPublicMatchesByPhaseIds } from '@/lib/supabase/queries/phase-matches';
import { getByeRoundsByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonById, getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getMatchesByTournament, getMatchesByTournamentIds } from '@/lib/supabase/queries/matches';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getAggregates, getAggregatesSummary } from '@/lib/supabase/queries/aggregates';
import { computeStandingsForSeason, loadRankingContext } from '@/lib/tournament/season-standings';
import { leaguePlayoffsFixture } from '@/test/fixtures/league-playoffs';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { expectNoPrivateMatchData } from '@/lib/match/__tests__/private-match-fields';
import { toPublicMatch } from '@/lib/match/public-match';
import { safeErrorResponse } from '@/lib/api/error-response';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

const routeContext = { params: Promise.resolve({ sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) };

const mockSeason = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Summer League 2024',
  season_id: null,
};

const mockTournament = {
  id: 'tourn-1',
  name: 'Swiss Stage',
  season_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

const mockParticipants = [
  { id: 'p1', name: 'Alice', avatar_url: 'https://example.com/alice.png' },
  { id: 'p2', name: 'Bob', avatar_url: null },
];

const mockMatch = {
  id: 'match-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: 'https://example.com/alice.png',
  player_2_avatar_url: null,
  winner_id: 'p1',
  winner_name: 'Alice',
  status: 'completed',
  updated_at: '2024-06-15T10:00:00Z',
  games: [
    { id: 'g1', winner_id: 'p1' },
    { id: 'g2', winner_id: 'p1' },
  ],
};

const mockStandings = [
  {
    player_id: 'p1',
    player_name: 'Alice',
    avatar_url: 'https://example.com/alice.png',
    wins: 1,
    losses: 0,
    draws: 0,
    rank: 1,
    game_wins: 2,
    game_losses: 0,
  },
  {
    player_id: 'p2',
    player_name: 'Bob',
    avatar_url: null,
    wins: 0,
    losses: 1,
    draws: 0,
    rank: 2,
    game_wins: 0,
    game_losses: 2,
  },
];

describe('GET /api/broadcast/standings/[sid]', () => {
  it.each(['legacy', 'frozen_legacy'] as const)('uses legacy bracket places and group records in %s', async (mode) => {
    const fixture = leaguePlayoffsFixture();
    vi.mocked(getPhaseRouteMode).mockResolvedValue(mode);
    vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, format_type: 'singles' } as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([...fixture.stages] as never);
    vi.mocked(getPublicSeasonParticipants).mockResolvedValue([...fixture.participants] as never);
    vi.mocked(getMatchesByTournamentIds).mockResolvedValue(new Map(fixture.matchesByStage));
    vi.mocked(getSeasonGroups).mockResolvedValue([...fixture.groups!] as never);
    vi.mocked(loadRankingContext).mockResolvedValue(undefined);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map());
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map());
    vi.mocked(getAggregates).mockResolvedValue([]);

    const response = await GET(makeRequest(), routeContext);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.standings.slice(0, 4).map((row: { player_id: string; rank: number }) => [row.player_id, row.rank]))
      .toEqual([['Orbit', 1], ['Nova', 2], ['Comet', 3], ['Meteor', 3]]);
    expect(body.data.standings[0].wins).toBe(0);
    expect(getMatchesByTournamentIds).toHaveBeenCalledOnce();
    expect(getAggregates).toHaveBeenCalledExactlyOnceWith('tournament', 'groups');
    expect(getParticipants).not.toHaveBeenCalled();
    expect(getPhasesBySeasonId).not.toHaveBeenCalled();
    expect(getPublicMatchesByPhaseIds).not.toHaveBeenCalled();
    expectNoPrivatePlayerData(body);
    expectNoPrivateMatchData(body);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPhaseRouteMode).mockResolvedValue('legacy');
  });

  describe('native reads', () => {
    const [phaseId, secondPhaseId, playoffId] = ['phase-1', 'phase-2', 'phase-playoff'];

    beforeEach(() => {
      vi.mocked(getPhaseRouteMode).mockResolvedValue('phase');
      vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, format_type: 'custom' } as never);
      vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map());
      vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map());
      vi.mocked(getAggregatesSummary).mockResolvedValue([]);
    });

    function expectNoLegacyReads() {
      expect(getAggregates).not.toHaveBeenCalled();
      expect(getStagesBySeasonId).not.toHaveBeenCalled();
      expect(getParticipants).not.toHaveBeenCalled();
      expect(getMatchesByTournament).not.toHaveBeenCalled();
      expect(getMatchesByTournamentIds).not.toHaveBeenCalled();
      expect(getRoundsByTournament).not.toHaveBeenCalled();
      expect(computeStandingsForSeason).not.toHaveBeenCalled();
      expect(loadRankingContext).not.toHaveBeenCalled();
    }

    it.each(['phase', 'frozen_phase'] as const)('reads only the primary phase without playoffs in %s', async (mode) => {
      vi.mocked(getPhaseRouteMode).mockResolvedValue(mode);
      vi.mocked(getPhasesBySeasonId).mockResolvedValue([
        { id: phaseId, name: 'First Swiss', bracket_type: 'swiss' },
        { id: secondPhaseId, name: 'Second Swiss', bracket_type: 'swiss' },
      ] as never);
      vi.mocked(getPublicPhaseStandingsParticipants).mockResolvedValue(mockParticipants as never);
      vi.mocked(getPublicMatchesByPhaseIds).mockResolvedValue(new Map([
        [phaseId, [{ ...mockMatch, phase_id: phaseId }]],
      ]) as never);
      vi.mocked(getByeRoundsByPhaseIds).mockResolvedValue(new Map([
        [phaseId, [{ id: 'round-1', phase_id: phaseId, round_number: 1, bye_player_ids: ['p2'] }]],
      ]));
      vi.mocked(loadNativeSeasonStandingsContext).mockResolvedValue({
        formatType: 'custom',
        kit: {
          engine: 'kit',
          stages: {
            [secondPhaseId]: { key: 'second', scoring: { win: 3, loss: 0, bye: 1 }, rank: [] },
            [phaseId]: { key: 'first', scoring: { win: 3, loss: 0, bye: 5 }, rank: [] },
          },
          stageOfMatch: { [mockMatch.id]: phaseId }, outcomes: {}, coinFlips: {},
        },
      });
      vi.mocked(getAggregatesSummary).mockResolvedValue([
        { pokemon_name: 'Eevee', total_kos_dealt: 7, total_brought: 3, total_wins: 3 },
      ] as never);

      const res = await GET(makeRequest(), routeContext);
      const body = await res.json();

      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(body.data.standings[0]).toMatchObject({ player_id: 'p2', wins: 1, points: 5 });
      expect(body.data.recent_results).toEqual([{
        match_id: mockMatch.id, player1_name: 'Alice', player2_name: 'Bob', winner_name: 'Alice',
        player1_avatar_url: mockMatch.player_1_avatar_url, player2_avatar_url: null, pokemon_score: '2-0', series_score: '2-0',
      }]);
      expect(body.data.leaders.most_kos).toMatchObject({ pokemon_name: 'Eevee', kos: 7 });
      expect(getPublicPhaseStandingsParticipants).toHaveBeenCalledExactlyOnceWith(phaseId);
      expect(getPublicMatchesByPhaseIds).toHaveBeenCalledExactlyOnceWith([phaseId]);
      expect(getByeRoundsByPhaseIds).toHaveBeenCalledExactlyOnceWith([phaseId]);
      expect(getAggregatesSummary).toHaveBeenCalledExactlyOnceWith('phase', phaseId);
      expect(getPublicSeasonParticipants).not.toHaveBeenCalled();
      expect(getSeasonGroups).not.toHaveBeenCalled();
      expectNoLegacyReads();
      expectNoPrivatePlayerData(body);
      expectNoPrivateMatchData(body);
    });

    it('ranks completed playoffs, keeps season-group standings, and includes playoff matches in results', async () => {
      const fixture = leaguePlayoffsFixture();
      vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, format_type: 'singles' } as never);
      vi.mocked(getPhasesBySeasonId).mockResolvedValue([
        { ...fixture.stages[0], id: phaseId, bracket_type: 'swiss' },
        { id: secondPhaseId, name: 'Second Swiss', bracket_type: 'swiss' },
        { ...fixture.stages[1], id: playoffId },
      ] as never);
      vi.mocked(loadNativeSeasonStandingsContext).mockResolvedValue(fixture.context);
      vi.mocked(getPublicSeasonParticipants).mockResolvedValue([...fixture.participants] as never);
      vi.mocked(getSeasonGroups).mockResolvedValue([...fixture.groups] as never);
      vi.mocked(getPublicMatchesByPhaseIds).mockResolvedValue(new Map(
        [...fixture.matchesByStage].map(([legacyId, matches]) => {
          const owner = legacyId === 'playoffs' ? playoffId : phaseId;
          return [owner, matches.map((match) => {
            const { tournament_id: _, ...facts } = toPublicMatch(match);
            return { ...facts, phase_id: owner, round_number: match.round_number,
              updated_at: legacyId === 'playoffs' ? '2026-09-10T00:00:00Z' : '2026-09-01T00:00:00Z' };
          })];
        }),
      ));
      vi.mocked(getByeRoundsByPhaseIds).mockResolvedValue(new Map([
        [phaseId, [{ id: 'one', phase_id: phaseId, round_number: 1, bye_player_ids: ['Pulsar'] }]],
        [secondPhaseId, [1, 2, 3].map((round) => ({
          id: `second-${round}`, phase_id: secondPhaseId, round_number: round, bye_player_ids: ['Quasar'],
        }))],
      ]));

      const body = await (await GET(makeRequest(), routeContext)).json();
      expect(body.data.standings.slice(0, 4).map(({ player_id, rank, wins }: { player_id: string; rank: number; wins: number }) =>
        [player_id, rank, wins])).toEqual([['Orbit', 1, 0], ['Nova', 2, 1], ['Comet', 3, 2], ['Meteor', 3, 1]]);
      expect(body.data.standings.slice(4)).toMatchObject([
        { player_id: 'Pulsar', wins: 2, losses: 0 },
        { player_id: 'Quasar', wins: 3, losses: 1 },
      ]);
      expect(body.data.recent_results).toHaveLength(5);
      expect(body.data.recent_results[0].match_id).toBe('playoffs-1-Comet');
      expect(getPublicPhaseStandingsParticipants).not.toHaveBeenCalled();
      expect(getSeasonGroups).toHaveBeenCalledExactlyOnceWith(mockSeason.id);
      expect(getPublicMatchesByPhaseIds).toHaveBeenCalledExactlyOnceWith([phaseId, secondPhaseId, playoffId]);
      expect(getByeRoundsByPhaseIds).toHaveBeenCalledExactlyOnceWith([phaseId, secondPhaseId]);
      expect(getAggregatesSummary).toHaveBeenCalledExactlyOnceWith('phase', phaseId);
      expectNoLegacyReads();
    });

    it('uses the EPB tiebreaker order without reading native bye rounds', async () => {
      const formatType = 'evolution_point_buy';
      vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, format_type: formatType } as never);
      vi.mocked(getPhasesBySeasonId).mockResolvedValue([{ id: phaseId, bracket_type: 'swiss' }] as never);
      vi.mocked(getPublicPhaseStandingsParticipants).mockResolvedValue(mockParticipants as never);
      vi.mocked(getPublicMatchesByPhaseIds).mockResolvedValue(new Map([
        [phaseId, [{ ...mockMatch, phase_id: phaseId }]],
      ]) as never);
      vi.mocked(loadNativeSeasonStandingsContext).mockResolvedValue({
        formatType, evolutionPoints: { p1: 0, p2: 5 }, tiebreakerOrder: ['evolution_points', 'match_points'],
      });

      const body = await (await GET(makeRequest(), routeContext)).json();
      expect(body.data.standings[0]).toMatchObject({ player_id: 'p2', evolution_points: 5, wins: 0 });
      expect(getByeRoundsByPhaseIds).not.toHaveBeenCalled();
      expectNoLegacyReads();
    });

    it('keeps the empty response when native phases are absent instead of falling back', async () => {
      vi.mocked(getPhasesBySeasonId).mockResolvedValue([]);
      const res = await GET(makeRequest(), routeContext);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect((await res.json()).data).toEqual({
        season_id: mockSeason.id, league_name: mockSeason.name, standings: [], recent_results: [],
        leaders: { season_id: mockSeason.id, most_kos: null, best_record: null, pokemon_mvp: null },
      });
      expect(getPublicMatchesByPhaseIds).not.toHaveBeenCalled();
      expect(getAggregatesSummary).not.toHaveBeenCalled();
      expectNoLegacyReads();
    });

    it('returns the safe error when the native stage read fails instead of retrying legacy', async () => {
      const error = new Error('Native read failed');
      vi.mocked(getPhasesBySeasonId).mockRejectedValueOnce(error);

      const res = await GET(makeRequest(), routeContext);
      expect(res.status).toBe(500);
      expect(safeErrorResponse).toHaveBeenCalledExactlyOnceWith(error, 'Failed to compute standings');
      expectNoLegacyReads();
    });
  });

  it('returns enriched standings for a season', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockTournament as never]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([mockMatch as never]);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue(mockStandings as never);

    const ratingsMap = new Map([
      ['p1', { rating: 1500, rd: 50, wins: 1, losses: 0, draws: 0, peak_rating: 1500 }],
    ]);
    const sigsMap = new Map([
      ['p1', [{ pokemon_name: 'Pikachu', games: 10 }]],
    ]);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(ratingsMap as never);
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(sigsMap as never);
    vi.mocked(getAggregates).mockResolvedValue([]);

    const request = makeRequest();
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.season_id).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(body.data.league_name).toBe('Summer League 2024');
    expect(body.data.standings).toHaveLength(2);
    expect(body.data.standings[0].rating).toBe(1500);
    expect(body.data.standings[0].signature_pokemon).toBe('Pikachu');
    expect(body.data.standings[0].signature_sprite_url).toBe(
      'https://sprites/Pikachu.png'
    );
    expect(body.data.standings[1].rating).toBeNull();
    expect(body.data.standings[1].signature_pokemon).toBeNull();
    expect(body.data.recent_results).toHaveLength(1);
    expect(body.data.leaders).toBeDefined();
  });

  describe('a Swiss primary stage', () => {
    const swissStage = { ...mockTournament, bracket_type: 'swiss' };

    function arrange(formatType: string) {
      vi.mocked(getSeasonById).mockResolvedValue({ ...mockSeason, format_type: formatType } as never);
      vi.mocked(getStagesBySeasonId).mockResolvedValue([swissStage as never]);
      vi.mocked(getMatchesByTournament).mockResolvedValue([mockMatch as never]);
      vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
      vi.mocked(computeStandingsForSeason).mockResolvedValue(mockStandings as never);
      vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map() as never);
      vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map() as never);
      vi.mocked(getAggregates).mockResolvedValue([]);
    }

    it('scores its stored byes', async () => {
      arrange('singles');
      vi.mocked(getRoundsByTournament).mockResolvedValue([
        { round_number: 1, bye_player_ids: ['p2'] },
      ] as never);

      const res = await GET(makeRequest(), routeContext);

      expect((await res.json()).success).toBe(true);
      expect(getRoundsByTournament).toHaveBeenCalledWith('tourn-1');
      expect(vi.mocked(computeStandingsForSeason).mock.calls[0][5]).toEqual({
        byes: [{ player_id: 'p2', round_number: 1 }],
      });
    });

    it('reads no rounds in an Evolution Point Buy league, which scores no byes', async () => {
      arrange('evolution_point_buy');

      const res = await GET(makeRequest(), routeContext);

      expect((await res.json()).success).toBe(true);
      expect(getRoundsByTournament).not.toHaveBeenCalled();
      expect(vi.mocked(computeStandingsForSeason).mock.calls[0][5]).toEqual({ byes: [] });
    });
  });

  it('returns 404 when season not found', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null as never);

    const request = makeRequest();
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Season not found', code: 'season_not_found' });
  });

  it('returns empty standings when no tournaments in season', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);

    const request = makeRequest();
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.standings).toEqual([]);
    expect(body.data.recent_results).toEqual([]);
    expect(body.data.leaders.most_kos).toBeNull();
    expect(body.data.leaders.best_record).toBeNull();
    expect(body.data.leaders.pokemon_mvp).toBeNull();
  });

  it('computes leaders from aggregates', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockTournament as never]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([mockMatch as never]);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue(mockStandings as never);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getAggregates).mockResolvedValue([
      {
        pokemon_name: 'Pikachu',
        total_kos_dealt: 15,
        total_brought: 5,
        total_wins: 4,
      },
      {
        pokemon_name: 'Charizard',
        total_kos_dealt: 10,
        total_brought: 3,
        total_wins: 3,
      },
    ] as never);

    const request = makeRequest();
    const res = await GET(request, routeContext);
    const body = await res.json();

    expect(body.data.leaders.most_kos).not.toBeNull();
    expect(body.data.leaders.most_kos.pokemon_name).toBe('Pikachu');
    expect(body.data.leaders.most_kos.kos).toBe(15);
    expect(body.data.leaders.pokemon_mvp).not.toBeNull();
    expect(body.data.leaders.pokemon_mvp.pokemon_name).toBe('Charizard');
    expect(body.data.leaders.best_record).not.toBeNull();
    expect(body.data.leaders.best_record.player_name).toBe('Alice');
  });

  it('sets public cache headers', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockTournament as never]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getPlayerSignaturesBatch).mockResolvedValue(new Map() as never);
    vi.mocked(getAggregates).mockResolvedValue([]);

    const request = makeRequest();
    const res = await GET(request, routeContext);

    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=120'
    );
  });

  it('delegates to safeErrorResponse on unexpected error', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('DB error'));

    const request = makeRequest();
    await GET(request, routeContext);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
