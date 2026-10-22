import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/games', () => ({
  createGame: vi.fn(),
  createBattleStats: vi.fn(),
  getNextGameNumber: vi.fn(),
  getGameWinCounts: vi.fn(),
  getGameById: vi.fn(),
  getGamesByMatch: vi.fn(async () => []),
  getBattleStatsByGame: vi.fn(async () => []),
  deleteBattleStatsByGame: vi.fn(),
  deleteUncountedGameRow: vi.fn(async () => 'deleted'),
  updateGameWinner: vi.fn(),
  setGameStatsLocked: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  buildGameAggregateDeltas: vi.fn(),
  rollbackGameAggregates: vi.fn(async () => 'rolled_back'),
}));

vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  shouldExcludeFromAllTime: vi.fn(async () => false),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  enqueueAggregateJob: vi.fn(),
  cancelAggregateJobsForGame: vi.fn(async () => 0),
  applyGameAggregatesNow: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  updateMatchStatus: vi.fn(),
  transitionMatchStatus: vi.fn(),
  getMatchById: vi.fn(),
  resetMatchFields: vi.fn(async () => {}),
  hasDownstreamMatches: vi.fn(async () => false),
  getMatchesByRound: vi.fn(async () => []),
  getMatchesByTournament: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  // revertRoundIfCompleted reads the round through the typed query.
  getRoundById: vi.fn(async () => ({ id: 'round-1', round_number: 1, best_of: 3, status: 'pending' })),
  updateRoundStatus: vi.fn(),
  getRoundsByTournament: vi.fn(async () => []),
}));

vi.mock('@/lib/tournament/match-state', () => ({
  hasReachedBoThreshold: vi.fn(() => ({ reached: false, winner_id_index: null })),
  validateTransition: vi.fn(() => ({ valid: true })),
}));

vi.mock('@/lib/draft/evolution-engine', () => ({
  checkPlayerEvolutions: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/match-analyses', () => ({
  deleteMatchAnalysis: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({
  deleteMatchPrepAnalysesByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-snapshots', () => ({
  deleteMatchSnapshots: vi.fn(),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  rebuildRatingsForPlayers: vi.fn(async (playerIds: string[]) =>
    playerIds.map((playerId) => ({
      playerId,
      addedToBatch: false,
      matchesReplayed: 0,
      ratingBefore: 1500,
      ratingAfter: 1500,
      unratedMatchIds: [],
      changed: false,
    }))
  ),
  // Read-only preflight before the reset writes anything (H13).
  planRatingRebuild: vi.fn(async (playerIds: string[]) => ({
    order: playerIds,
    addedPlayerIds: [],
    healedGaps: [],
  })),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  recomputeStreaks: vi.fn(),
}));

vi.mock('@/lib/gamification/signatures', () => ({
  updateSignatures: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { best_of: 3, status: 'pending' } })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/match/evolution-match-evaluator', () => ({
  creditMatchRealKills: vi.fn(),
  uncreditGameRealKills: vi.fn(),
  recheckEpbStages: vi.fn(async () => []),
}));

vi.mock('@/lib/match/match-children', () => ({
  cleanMatchChildren: vi.fn(async () => ({
    matchPrepTeamsDeleted: 0,
    matchProposalsDeleted: 0,
    broadcastMomentsDeleted: 0,
    animationViewsDeleted: 0,
    teamPointersCleared: 0,
    castSessionPointersCleared: 0,
    agentSuggestionPointersCleared: 0,
    socialImageCleared: true,
  })),
}));

vi.mock('@/lib/reconcile/evolution-rebuild', () => ({
  repairSeasonEvolution: vi.fn(async () => ({
    trackersUpdated: 0,
    eventsRewritten: 0,
    impossibleLineups: [],
    evolutionPoints: { players_updated: 0, points_awarded: 0 },
  })),
}));

vi.mock('@/lib/tournament/bracket-propagation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tournament/bracket-propagation')>();
  return {
    ...actual,
    unpropagateBracketOnMatchReset: vi.fn(async () => []),
  };
});

import { resetMatch } from '../game-pipeline';
import { planRatingRebuild } from '@/lib/rating/updateRatings';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  getMatchById,
  getMatchesByTournament,
  hasDownstreamMatches,
  resetMatchFields,
} from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getGamesByMatch } from '@/lib/supabase/queries/games';
import { buildSingleElimStructure } from '@/lib/tournament/bracket-structure';
import type { MatchWithPlayers } from '@/types/match';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';
import type { Round } from '@/types/round';

function makeParticipants(n: number): ParticipantWithSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
    starting_bracket: 'winners',
    discord_id: null,
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: null,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

function makeTournament(): Tournament {
  return {
    id: 't1',
    name: 'Test Cup',
    description: '',
    season_id: null,
    bracket_type: 'single_elim',
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 1,
    stage_order: 1,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeMatch(partial: {
  id: string;
  round_id: string;
  player_1_id: string;
  player_2_id: string;
  bracket_side?: MatchWithPlayers['bracket_side'];
  bracket_pos?: number | null;
  status?: MatchWithPlayers['status'];
  winner_id?: string | null;
  games?: MatchWithPlayers['games'];
}): MatchWithPlayers {
  return {
    id: partial.id,
    round_id: partial.round_id,
    tournament_id: 't1',
    player_1_id: partial.player_1_id,
    player_2_id: partial.player_2_id,
    winner_id: partial.winner_id ?? null,
    status: partial.status ?? 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: partial.bracket_side ?? null,
    bracket_pos: partial.bracket_pos ?? null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    player_1_name: '',
    player_2_name: '',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: null,
    round_status: 'pending',
    games: partial.games ?? [],
  };
}

describe('resetMatch cascade', () => {
  const structure = buildSingleElimStructure(4);
  const rounds: Round[] = structure.rounds.map((r) => ({
    id: `round-${r.round_number}`,
    tournament_id: 't1',
    name: r.name,
    round_number: r.round_number,
    best_of: 3,
    status: 'pending',
    pairings_generated: true,
    deadline: null,
    bracket_side: r.bracket_side,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));

  const originSlot = structure.slots.find(
    (s) => s.global_round_number === 1 && s.bracket_pos === 0
  )!;
  const finalsSlot = structure.slots.find(
    (s) => s.round_name === 'Finals'
  )!;

  let origin: MatchWithPlayers;
  let finals: MatchWithPlayers;
  const matchById = new Map<string, MatchWithPlayers>();

  beforeEach(() => {
    vi.clearAllMocks();
    origin = makeMatch({
      id: 'm-r1',
      round_id: `round-${originSlot.global_round_number}`,
      player_1_id: 'p1',
      player_2_id: 'p4',
      bracket_side: originSlot.bracket_side,
      bracket_pos: originSlot.bracket_pos,
      status: 'completed',
      winner_id: 'p1',
    });
    finals = makeMatch({
      id: 'm-finals',
      round_id: `round-${finalsSlot.global_round_number}`,
      player_1_id: 'p1',
      player_2_id: 'p2',
      bracket_side: finalsSlot.bracket_side,
      bracket_pos: finalsSlot.bracket_pos,
      status: 'completed',
      winner_id: 'p1',
      games: [
        {
          id: 'g-finals',
          game_number: 1,
          winner_id: 'p1',
          replay_url: '',
          source: 'manual',
          stats_locked: false,
        },
      ],
    });
    matchById.clear();
    matchById.set(origin.id, origin);
    matchById.set(finals.id, finals);

    vi.mocked(getTournamentById).mockResolvedValue(makeTournament());
    vi.mocked(getParticipants).mockResolvedValue(makeParticipants(4));
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds);
    vi.mocked(getMatchesByTournament).mockImplementation(async () => [
      matchById.get('m-r1')!,
      matchById.get('m-finals')!,
    ]);
    vi.mocked(getMatchById).mockImplementation(async (id) => matchById.get(id) ?? null);
    vi.mocked(getGamesByMatch).mockImplementation(async (id) => {
      const summaries = matchById.get(id)?.games ?? [];
      // getGamesByMatch returns full Game rows — widen the stored GameSummary
      // fixtures with the fields Game adds.
      return summaries.map((g) => ({
        ...g,
        match_id: id,
        replay_hash: null,
        parsed: true,
        exclude_all_time: false,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }));
    });
    vi.mocked(resetMatchFields).mockImplementation(async (id) => {
      const current = matchById.get(id);
      if (current) {
        matchById.set(id, { ...current, status: 'scheduled', winner_id: null, games: [] });
      }
      return current as never;
    });
    vi.mocked(hasDownstreamMatches).mockResolvedValue(false);
  });

  it('refuses reset when a downstream match has results and cascade is false', async () => {
    await expect(resetMatch('m-r1', 'admin-1', false)).rejects.toMatchObject({
      name: 'UserFacingError',
      code: 'DOWNSTREAM_PLAYED',
      statusCode: 409,
    });
    expect(resetMatchFields).not.toHaveBeenCalled();
    expect(planRatingRebuild).not.toHaveBeenCalled();
  });

  it('plans the rating rebuild for the whole cascade before any match is reset', async () => {
    await resetMatch('m-r1', 'admin-1', true);

    // First call: the origin's preflight, covering the downstream finals too.
    expect(vi.mocked(planRatingRebuild).mock.calls[0]).toEqual([
      ['p1', 'p4', 'p2'],
      { excludeMatchIds: ['m-r1', 'm-finals'] },
    ]);
    const planOrder = vi.mocked(planRatingRebuild).mock.invocationCallOrder[0];
    for (const order of vi.mocked(resetMatchFields).mock.invocationCallOrder) {
      expect(planOrder).toBeLessThan(order);
    }
  });

  it('a refused cascade rating plan resets no match at all', async () => {
    const refusal = new UserFacingError('Rating history has gaps that no rebuild order can fill', {
      code: 'rating_history_incomplete',
      params: { count: 1, players: 'p1, p2' },
      status: 409,
    });
    vi.mocked(planRatingRebuild).mockRejectedValueOnce(refusal);

    await expect(resetMatch('m-r1', 'admin-1', true)).rejects.toBe(refusal);
    expect(resetMatchFields).not.toHaveBeenCalled();
  });

  it('skips the cascade check for legacy matches without bracket_pos', async () => {
    const legacy = makeMatch({
      id: 'm-legacy',
      round_id: 'round-1',
      player_1_id: 'p1',
      player_2_id: 'p2',
      bracket_pos: null,
      status: 'completed',
      winner_id: 'p1',
    });
    matchById.set(legacy.id, legacy);

    await resetMatch('m-legacy', 'admin-1', false);

    expect(resetMatchFields).toHaveBeenCalledWith('m-legacy');
    expect(hasDownstreamMatches).toHaveBeenCalledWith(
      'm-legacy',
      expect.objectContaining({ winner_id: 'p1', round_id: 'round-1' })
    );
  });

  it('resets downstream matches deepest-first when cascade is true', async () => {
    const result = await resetMatch('m-r1', 'admin-1', true);

    const finalsReset = vi.mocked(resetMatchFields).mock.invocationCallOrder.find((_, i) =>
      vi.mocked(resetMatchFields).mock.calls[i][0] === 'm-finals'
    );
    const originReset = vi.mocked(resetMatchFields).mock.invocationCallOrder.find((_, i) =>
      vi.mocked(resetMatchFields).mock.calls[i][0] === 'm-r1'
    );
    expect(finalsReset).toBeDefined();
    expect(originReset).toBeDefined();
    expect(finalsReset!).toBeLessThan(originReset!);
    expect(result.has_downstream_matches).toBe(true);
    expect(hasDownstreamMatches).toHaveBeenCalledWith(
      'm-finals',
      expect.objectContaining({ winner_id: 'p1', round_id: 'round-2' })
    );
  });

  it('throws UserFacingError so API routes can surface DOWNSTREAM_PLAYED', async () => {
    try {
      await resetMatch('m-r1', 'admin-1', false);
      throw new Error('expected refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError);
      expect((err as UserFacingError).code).toBe('DOWNSTREAM_PLAYED');
      // The client renders the errors/matches plural from this count.
      const count = (err as UserFacingError).params?.count;
      expect(typeof count).toBe('number');
      expect((err as UserFacingError).message).toBe(
        `${count} downstream match(es) have results or are in progress. Pass cascade: true to reset the whole chain.`
      );
    }
  });
});
