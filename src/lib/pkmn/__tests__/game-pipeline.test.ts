import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all query imports ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/games', () => ({
  createGame: vi.fn(async (input: Record<string, unknown>) => ({ id: 'game-1', ...input })),
  createBattleStats: vi.fn(async (stats: unknown[]) => stats.map((s, i) => ({ id: `stat-${i}`, ...(s as Record<string, unknown>) }))),
  getNextGameNumber: vi.fn(async () => 1),
  getGameWinCounts: vi.fn(async () => ({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] })),
  getGameById: vi.fn(async () => ({
    id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
    replay_url: '', source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: '2026-05-21T00:00:00Z',
    exclude_all_time: false,
  })),
  getGamesByMatch: vi.fn(async () => []),
  getBattleStatsByGame: vi.fn(async () => []),
  deleteBattleStatsByGame: vi.fn(async () => {}),
  deleteGameRow: vi.fn(async () => {}),
  updateGameWinner: vi.fn(async () => {}),
  setGameStatsLocked: vi.fn(async () => {}),
  markGameAggregatesApplied: vi.fn(async () => ({
    id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
    replay_url: '', source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: '2026-05-21T00:00:00Z',
    exclude_all_time: false,
  })),
  clearGameAggregatesApplied: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  updateAggregates: vi.fn(async () => {}),
  rollbackAggregates: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  shouldExcludeFromAllTime: vi.fn(async () => false),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  enqueueAggregateJob: vi.fn(async () => {}),
  cancelAggregateJobsForGame: vi.fn(async () => 0),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  updateMatchStatus: vi.fn(async () => {}),
  updateMatchConfirmationTiming: vi.fn(async () => {}),
  getMatchById: vi.fn(async () => ({
    id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
    player_1_id: 'player-1', player_2_id: 'player-2',
    status: 'in_progress', winner_id: null,
    player_1_name: 'Alice', player_2_name: 'Bob',
    games: [],
  })),
  resetMatchFields: vi.fn(async () => {}),
  hasDownstreamMatches: vi.fn(async () => false),
  getMatchesByRound: vi.fn(async () => []),
  getMatchesByTournament: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(async () => ({
    id: 'tourney-1', season_id: null, ruleset_id: null,
    name: 'Test Tournament', best_of_default: 3,
    bracket_type: 'single_elim',
  })),
  getParticipants: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  updateRoundStatus: vi.fn(async () => {}),
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
  deleteMatchAnalysis: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({
  deleteMatchPrepAnalysesByMatch: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/queries/match-snapshots', () => ({
  deleteMatchSnapshots: vi.fn(async () => {}),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  // T5: rebuildRatingsForPlayers REPLACES rollbackRatingsForMatch in resetMatch.
  // recordGameResult's live rating write path is out of scope for this suite.
  rebuildRatingsForPlayers: vi.fn(async (playerIds: string[]) =>
    playerIds.map(() => ({ matchesReplayed: 0, ratingBefore: 1500, ratingAfter: 1500 })),
  ),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  recomputeStreaks: vi.fn(async () => {}),
}));

vi.mock('@/lib/gamification/signatures', () => ({
  updateSignatures: vi.fn(async () => {}),
}));

// Mock dynamic import of supabase client (used in reevaluateMatchStatus / revertRoundIfCompleted)
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { best_of: 3, status: 'pending' } })),
          // Seasons format check in recordGameResult/recheckEvolutions:
          // no format_type → legacy (non-EPB) path
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/match/evolution-match-evaluator', () => ({
  applyRealKillsFromGame: vi.fn(async () => []),
  rollbackRealKillsFromGame: vi.fn(async () => undefined),
  recheckEpbStages: vi.fn(async () => []),
}));

// T5: mock the match-children cleanup so reset/delete can assert it is called.
// The cleanup helpers it delegates to are exercised in match-children's own
// suite; here we only verify the pipeline invokes cleanMatchChildren(matchId).
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

// T5: mock the EPB evolution rebuild engine. repairSeasonEvolution returns a
// RepairResult-shaped object with a mocked impossibleLineups array.
vi.mock('@/lib/reconcile/evolution-rebuild', () => ({
  repairSeasonEvolution: vi.fn(async () => ({
    trackersUpdated: 0,
    eventsRewritten: 0,
    impossibleLineups: [],
    evolutionPoints: { players_updated: 0, points_awarded: 0 },
  })),
}));

import { recordGameResult, deleteGame, resetMatch, resetRound, editGame } from '../game-pipeline';
import { getMatchById, getMatchesByRound, hasDownstreamMatches, resetMatchFields, updateMatchConfirmationTiming } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { hasReachedBoThreshold, validateTransition } from '@/lib/tournament/match-state';
import { checkPlayerEvolutions } from '@/lib/draft/evolution-engine';
import {
  createGame,
  getGameById,
  getGamesByMatch,
  getBattleStatsByGame,
  getGameWinCounts,
  markGameAggregatesApplied,
} from '@/lib/supabase/queries/games';
import { updateAggregates, rollbackAggregates } from '@/lib/supabase/queries/aggregates';
import { shouldExcludeFromAllTime } from '@/lib/supabase/queries/test-accounts';
import { rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { cleanMatchChildren } from '@/lib/match/match-children';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';

describe('recordGameResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a game for an in_progress match', async () => {
    const result = await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(result.game_id).toBe('game-1');
    expect(result.match_status).toBe('in_progress');
    expect(result.bo_reached).toBe(false);
  });

  it('auto-transitions scheduled → in_progress on first game', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'scheduled', winner_id: null,
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    const result = await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(validateTransition).toHaveBeenCalledWith('scheduled', 'in_progress', expect.any(Object));
    expect(result.match_status).toBe('in_progress');
  });

  it('throws for non-participant, non-admin', async () => {
    await expect(
      recordGameResult({
        match_id: 'match-1',
        winner_id: 'player-1',
        source: 'manual' as const,
        battle_stats: [],
        submitter_id: 'stranger',
      })
    ).rejects.toThrow('Only match participants or admins');
  });

  it('rejects duplicate replay_url within the same match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'in_progress', winner_id: null,
      player_1_name: 'Alice', player_2_name: 'Bob',
      games: [{
        id: 'game-existing',
        game_number: 1,
        winner_id: 'player-1',
        replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1234567890',
        source: 'ps_replay',
        stats_locked: false,
      }],
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    await expect(
      recordGameResult({
        match_id: 'match-1',
        winner_id: 'player-2',
        replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1234567890#turn-5',
        source: 'ps_replay',
        battle_stats: [],
        submitter_id: 'player-1',
      })
    ).rejects.toMatchObject({
      name: 'DuplicateReplayError',
      code: 'duplicate_replay',
      statusCode: 409,
    });
  });

  it('allows admin to submit on behalf of players', async () => {
    const result = await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'admin-user',
      is_admin: true,
    });

    expect(result.game_id).toBe('game-1');
  });

  it('throws if match is in a non-submittable state', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    await expect(
      recordGameResult({
        match_id: 'match-1',
        winner_id: 'player-1',
        source: 'manual' as const,
        battle_stats: [],
        submitter_id: 'player-1',
      })
    ).rejects.toThrow('Cannot submit game for match in completed state');
  });

  it('transitions to pending_confirmation when Bo threshold is reached', async () => {
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({
      reached: true,
      winner_id_index: 1,
    });

    const result = await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(result.bo_reached).toBe(true);
    expect(result.match_winner_id).toBe('player-1');
    expect(result.match_status).toBe('pending_confirmation');
    expect(updateMatchConfirmationTiming).toHaveBeenCalledWith('match-1', {
      auto_confirm_at: null,
      confirmed_at: null,
    });
  });

  it('sets a 48 hour auto-confirm timer for manual results with screenshots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({
      reached: true,
      winner_id_index: 1,
    });

    await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      screenshot_url: 'https://example.com/screenshot.png',
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(updateMatchConfirmationTiming).toHaveBeenCalledWith('match-1', {
      auto_confirm_at: '2026-05-23T00:00:00.000Z',
      confirmed_at: null,
    });
    vi.useRealTimers();
  });

  it('checks evolutions when tournament has a season', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test', best_of_default: 3,
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);

    await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(checkPlayerEvolutions).toHaveBeenCalledTimes(2);
  });

  it('throws if match not found', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(null);
    await expect(
      recordGameResult({
        match_id: 'nonexistent',
        winner_id: 'player-1',
        source: 'manual' as const,
        battle_stats: [],
        submitter_id: 'player-1',
      })
    ).rejects.toThrow('Match not found');
  });

  it('throws if tournament not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(null);
    await expect(
      recordGameResult({
        match_id: 'match-1',
        winner_id: 'player-1',
        source: 'manual' as const,
        battle_stats: [],
        submitter_id: 'player-1',
      })
    ).rejects.toThrow('Tournament not found');
  });

  it('persists exclude_all_time=true on the games row when the season is a test season', async () => {
    // shouldExcludeFromAllTime is computed once at creation time and frozen;
    // the persisted flag must be passed into createGame verbatim.
    vi.mocked(shouldExcludeFromAllTime).mockResolvedValueOnce(true);

    await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(shouldExcludeFromAllTime).toHaveBeenCalledTimes(1);
    expect(createGame).toHaveBeenCalledWith(
      expect.objectContaining({ exclude_all_time: true }),
    );
  });

  it('persists exclude_all_time=false for normal seasons', async () => {
    vi.mocked(shouldExcludeFromAllTime).mockResolvedValueOnce(false);

    await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });

    expect(createGame).toHaveBeenCalledWith(
      expect.objectContaining({ exclude_all_time: false }),
    );
  });
});

describe('deleteGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGamesByMatch).mockResolvedValue([]);
    vi.mocked(getGameWinCounts).mockResolvedValue({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
  });

  it('deletes a game and re-evaluates match status', async () => {
    const result = await deleteGame('game-1', 'admin-1');
    expect(rollbackAggregates).toHaveBeenCalledTimes(0); // empty stats
    expect(result.match_status).toBe('scheduled'); // 0 games left → scheduled
    expect(result.games_remaining).toBe(0);
  });

  it('throws for unknown game', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(null);
    await expect(deleteGame('nonexistent', 'admin-1')).rejects.toThrow('Game not found');
  });

  it('rolls back aggregates when stats exist', async () => {
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      { id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false, moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '' },
    ]);

    await deleteGame('game-1', 'admin-1');
    expect(rollbackAggregates).toHaveBeenCalledTimes(1);
  });

  it('reads the persisted exclude_all_time flag instead of recomputing it', async () => {
    // Game row carries exclude_all_time=true (frozen at creation). The rollback
    // path must use that value verbatim — even though shouldExcludeFromAllTime
    // (the create-time computation) would now return false here, proving the
    // hot path no longer recomputes the gate at read time.
    //
    // deleteGame fetches the game once itself, then rollbackAndDeleteGame
    // fetches it again, so queue the test game for BOTH calls.
    const testGame = {
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z', exclude_all_time: true,
    } as Awaited<ReturnType<typeof getGameById>>;
    vi.mocked(getGameById).mockResolvedValueOnce(testGame).mockResolvedValueOnce(testGame);
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      { id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false, moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '' },
    ]);
    vi.mocked(shouldExcludeFromAllTime).mockResolvedValue(false);

    await deleteGame('game-1', 'admin-1');

    expect(shouldExcludeFromAllTime).not.toHaveBeenCalled();
    expect(rollbackAggregates).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      null,
      { excludeAllTime: true },
    );
  });

  it('for an EPB season calls repairSeasonEvolution and surfaces impossible lineups', async () => {
    // deleteGame fetches the game once itself, then rollbackAndDeleteGame
    // fetches it again — queue the test game for BOTH calls.
    const testGame = {
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z', exclude_all_time: false,
    } as Awaited<ReturnType<typeof getGameById>>;
    vi.mocked(getGameById).mockResolvedValueOnce(testGame).mockResolvedValueOnce(testGame);
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
      name: 'Test', best_of_default: 3, season_format_type: 'evolution_point_buy',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);

    const result = await deleteGame('game-1', 'admin-1');

    // EPB evolution: repairSeasonEvolution runs (whole-season rebuild); the
    // inverse rollbackRealKillsFromGame/recheckEpbStages path is NOT used.
    expect(repairSeasonEvolution).toHaveBeenCalledTimes(1);
    expect(repairSeasonEvolution).toHaveBeenCalledWith('season-epb');
    // Result carries the mocked impossible lineups from the repair.
    expect(result.impossibleLineups).toEqual([]);
  });

  it('for an EPB season surfaces an itemized recalculation summary (spec §24)', async () => {
    const testGame = {
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z', exclude_all_time: false,
    } as Awaited<ReturnType<typeof getGameById>>;
    vi.mocked(getGameById).mockResolvedValueOnce(testGame).mockResolvedValueOnce(testGame);
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
      name: 'Test', best_of_default: 3, season_format_type: 'evolution_point_buy',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(repairSeasonEvolution).mockResolvedValueOnce({
      trackersUpdated: 2,
      eventsRewritten: 4,
      impossibleLineups: [
        { matchId: 'match-later', playerId: 'player-2', basePokemon: 'pichu',
          snapshotStage: 1, rebuiltMaxStageByMatchday: 0, matchday: 2 },
      ],
      evolutionPoints: { players_updated: 1, points_awarded: 3 },
    });

    const result = await deleteGame('game-1', 'admin-1');

    // deleteGame deletes a single game (gamesDeleted: 1). A single-game delete
    // does not rebuild ratings (that is a reset-level concern), so ratingsRebuilt
    // is omitted; only the EPB evolution detail + impossible lineups are surfaced.
    expect(result.recalculation).toBeDefined();
    expect(result.recalculation!.gamesDeleted).toBe(1);
    expect(result.recalculation!.ratingsRebuilt).toBeUndefined();
    expect(result.recalculation!.evolutionRepaired).toEqual({
      trackersUpdated: 2,
      eventsRewritten: 4,
      evolutionPoints: 3,
      impossibleLineups: [
        expect.objectContaining({ matchId: 'match-later' }),
      ],
    });
    expect(result.recalculation!.impossibleLineups).toHaveLength(1);
  });
});

describe('resetMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGamesByMatch).mockResolvedValue([]);
  });

  it('resets a match with games to scheduled', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'in_progress', winner_id: null,
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    const result = await resetMatch('match-1', 'admin-1');
    expect(result.games_deleted).toBe(0);
    expect(result.has_downstream_matches).toBe(false);
    expect(hasDownstreamMatches).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        tournament_id: 'tourney-1',
        winner_id: null,
        round_id: 'round-1',
      })
    );
  });

  it('throws if match is already scheduled', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'scheduled', winner_id: null,
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    await expect(resetMatch('match-1', 'admin-1')).rejects.toThrow('already in scheduled state');
  });

  it('calls cleanMatchChildren for the match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'in_progress', winner_id: null,
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    const result = await resetMatch('match-1', 'admin-1');

    expect(cleanMatchChildren).toHaveBeenCalledTimes(1);
    expect(cleanMatchChildren).toHaveBeenCalledWith('match-1');
    // The cleanup summary is forwarded on the result.
    expect(result.childrenCleanup).toBeDefined();
  });

  it('for an EPB completed match calls repairSeasonEvolution (not the inverse path) and rebuildRatingsForPlayers([p1,p2])', async () => {
    // EPB season: season_id set + season_format_type 'evolution_point_buy'.
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
      name: 'Test', best_of_default: 3, season_format_type: 'evolution_point_buy',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);

    const result = await resetMatch('match-1', 'admin-1');

    // EPB evolution: repairSeasonEvolution runs (NOT the inverse
    // rollbackRealKillsFromGame/recheckEpbStages, which are mocked but
    // should NOT be called from resetMatch's EPB branch).
    expect(repairSeasonEvolution).toHaveBeenCalledTimes(1);
    expect(repairSeasonEvolution).toHaveBeenCalledWith('season-epb');
    // Ratings: rebuildRatingsForPlayers replays both players (replaces the
    // old rollbackRatingsForMatch inverse path).
    expect(rebuildRatingsForPlayers).toHaveBeenCalledTimes(1);
    expect(rebuildRatingsForPlayers).toHaveBeenCalledWith(['player-1', 'player-2']);
    // Streaks + signatures still recomputed for both players.
    expect(recomputeStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    // Result carries the mocked impossible lineups + cleanup summary.
    expect(result.impossibleLineups).toEqual([]);
    expect(result.childrenCleanup).toBeDefined();
  });

  it('for an EPB completed match surfaces an itemized recalculation summary (spec §24)', async () => {
    // EPB repair returns a non-trivial RepairResult so the summary can be
    // asserted against the actual projected values (not just the mocked zeros).
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
      name: 'Test', best_of_default: 3, season_format_type: 'evolution_point_buy',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(getGamesByMatch).mockResolvedValueOnce([
      { id: 'game-a', game_number: 1, winner_id: 'player-1' } as never,
      { id: 'game-b', game_number: 2, winner_id: 'player-1' } as never,
    ]);
    vi.mocked(repairSeasonEvolution).mockResolvedValueOnce({
      trackersUpdated: 3,
      eventsRewritten: 7,
      impossibleLineups: [
        { matchId: 'match-later', playerId: 'player-1', basePokemon: 'eevee',
          snapshotStage: 2, rebuiltMaxStageByMatchday: 1, matchday: 3 },
      ],
      evolutionPoints: { players_updated: 2, points_awarded: 5 },
    });

    const result = await resetMatch('match-1', 'admin-1');

    // recalculation is the richer, unified view (spec §24). The legacy
    // top-level fields remain for backward compat.
    expect(result.recalculation).toBeDefined();
    expect(result.recalculation!.gamesDeleted).toBe(2);
    // Ratings rebuilt for both match participants (the rebuildRatingsForPlayers
    // input ids).
    expect(result.recalculation!.ratingsRebuilt).toEqual({ players: ['player-1', 'player-2'] });
    // Children cleanup forwarded from cleanMatchChildren.
    expect(result.recalculation!.childrenCleanup).toEqual(result.childrenCleanup);
    // EPB evolution detail projected from the mocked RepairResult.
    expect(result.recalculation!.evolutionRepaired).toEqual({
      trackersUpdated: 3,
      eventsRewritten: 7,
      evolutionPoints: 5,
      impossibleLineups: [
        expect.objectContaining({ matchId: 'match-later' }),
      ],
    });
    // Unified impossibleLineups mirrors the EPB repair result.
    expect(result.recalculation!.impossibleLineups).toHaveLength(1);
    expect(result.recalculation!.impossibleLineups[0].matchId).toBe('match-later');
  });

  it('runs resetMatchFields BEFORE ratings/streaks/evolution rebuilds', async () => {
    // Order is load-bearing: resetMatchFields must flip status to 'scheduled'
    // before the ratings/streak/evolution rebuilds run, so their
    // status='completed' filters exclude this match. Capture call order via
    // mock.invocationCallOrder.
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
      name: 'Test', best_of_default: 3, season_format_type: 'evolution_point_buy',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);

    await resetMatch('match-1', 'admin-1');

    const resetOrder = vi.mocked(resetMatchFields).mock.invocationCallOrder[0];
    const ratingsOrder = vi.mocked(rebuildRatingsForPlayers).mock.invocationCallOrder[0];
    const streaksOrder = vi.mocked(recomputeStreaks).mock.invocationCallOrder[0];
    const repairOrder = vi.mocked(repairSeasonEvolution).mock.invocationCallOrder[0];

    expect(resetOrder).toBeLessThan(ratingsOrder);
    expect(resetOrder).toBeLessThan(streaksOrder);
    expect(resetOrder).toBeLessThan(repairOrder);
  });

  it('for a legacy (non-EPB) season still calls recheckEvolutions (checkPlayerEvolutions path)', async () => {
    // Legacy: season_id set but season_format_type is NOT 'evolution_point_buy'
    // (default tournament mock has no season_format_type → legacy path).
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-legacy', ruleset_id: null,
      name: 'Test', best_of_default: 3,
      // no season_format_type → legacy (non-EPB)
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);

    const result = await resetMatch('match-1', 'admin-1');

    // Legacy: checkPlayerEvolutions runs for both players (the recheckEvolutions
    // legacy branch), and the EPB repair engine is NOT invoked.
    expect(checkPlayerEvolutions).toHaveBeenCalledTimes(2);
    expect(repairSeasonEvolution).not.toHaveBeenCalled();

    // Legacy recalculation summary: ratings rebuilt for both players (the match
    // was completed), but no EPB evolution detail and an empty impossible-lineups
    // array (no whole-season rebuild runs to surface any).
    expect(result.recalculation).toBeDefined();
    expect(result.recalculation!.ratingsRebuilt).toEqual({ players: ['player-1', 'player-2'] });
    expect(result.recalculation!.evolutionRepaired).toBeUndefined();
    expect(result.recalculation!.impossibleLineups).toEqual([]);
  });
});

describe('resetRound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets all non-scheduled matches in a round', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'player-1', player_2_id: 'player-2',
        status: 'in_progress', winner_id: null,
        player_1_name: 'A', player_2_name: 'B',
      },
      {
        id: 'match-2', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'player-3', player_2_id: 'player-4',
        status: 'scheduled', winner_id: null,
        player_1_name: 'C', player_2_name: 'D',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    // For the resetMatch call on match-1
    vi.mocked(getMatchById).mockResolvedValueOnce({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'in_progress', winner_id: null,
      player_1_name: 'A', player_2_name: 'B',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never);

    vi.mocked(getGamesByMatch).mockResolvedValue([]);

    const result = await resetRound('round-1', 'admin-1');
    expect(result.matches_reset).toBe(1);
    expect(result.total_games_deleted).toBe(0);
  });

  it('handles empty round', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([]);

    const result = await resetRound('round-1', 'admin-1');
    expect(result.matches_reset).toBe(0);
  });
});

describe('editGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGameWinCounts).mockResolvedValue({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
  });

  it('edits a game winner and re-applies aggregates', async () => {
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      {
        id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu',
        was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false,
        moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '',
      },
    ]);

    const result = await editGame({
      game_id: 'game-1',
      winner_id: 'player-2',
      admin_id: 'admin-1',
    });

    expect(rollbackAggregates).toHaveBeenCalledTimes(1);
    expect(updateAggregates).toHaveBeenCalledTimes(1);
    expect(result.match_status).toBeDefined();
  });

  it('edits with new battle_stats', async () => {
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([]);

    const result = await editGame({
      game_id: 'game-1',
      battle_stats: [
        { player_id: 'player-1', pokemon_name: 'Pikachu', kos_dealt: 3 },
      ],
      admin_id: 'admin-1',
    });

    expect(result.match_status).toBeDefined();
  });

  it('throws for unknown game', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(null);
    await expect(
      editGame({ game_id: 'nonexistent', admin_id: 'admin-1' })
    ).rejects.toThrow('Game not found');
  });

  it('keeps old stats when winner unchanged and no new stats', async () => {
    // Game winner_id matches input winner_id (same) and no battle_stats provided
    vi.mocked(getGameById).mockResolvedValueOnce({
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: '2026-05-21T00:00:00Z',
      exclude_all_time: false,
    } as Awaited<ReturnType<typeof getGameById>>);
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      {
        id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu',
        was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false,
        moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '',
      },
    ]);

    const result = await editGame({
      game_id: 'game-1',
      admin_id: 'admin-1',
      // No winner_id change, no battle_stats
    });

    // Should still re-apply aggregates
    expect(updateAggregates).toHaveBeenCalledTimes(1);
    expect(markGameAggregatesApplied).toHaveBeenCalledWith('game-1');
    expect(result.match_status).toBeDefined();
  });

  it('does not roll back aggregates when the original queued job was not applied', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce({
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: null,
      exclude_all_time: false,
    } as Awaited<ReturnType<typeof getGameById>>);
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      {
        id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu',
        was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false,
        moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '',
      },
    ]);

    await editGame({
      game_id: 'game-1',
      winner_id: 'player-2',
      admin_id: 'admin-1',
    });

    expect(rollbackAggregates).not.toHaveBeenCalled();
    expect(updateAggregates).toHaveBeenCalledTimes(1);
  });

  it('reads the persisted exclude_all_time flag for both rollback and re-apply (does not recompute)', async () => {
    // Game row carries exclude_all_time=true (frozen at creation) with applied
    // aggregates, so editGame must roll back the old stats AND re-apply the new
    // stats using that persisted flag verbatim — even though
    // shouldExcludeFromAllTime (the create-time computation) would now return
    // false here, proving the hot path no longer recomputes the gate at read
    // time. editGame fetches the game once, so a single mock is sufficient.
    vi.mocked(getGameById).mockResolvedValueOnce({
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z', exclude_all_time: true,
    } as Awaited<ReturnType<typeof getGameById>>);
    // No battle_stats provided and winner unchanged → newStats === oldStats,
    // so one getBattleStatsByGame call feeds both the rollback and re-apply.
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      { id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false, moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '' },
    ]);
    vi.mocked(shouldExcludeFromAllTime).mockResolvedValue(false);

    await editGame({
      game_id: 'game-1',
      admin_id: 'admin-1',
      // No winner_id change, no battle_stats → newStats === oldStats
    });

    expect(shouldExcludeFromAllTime).not.toHaveBeenCalled();
    expect(rollbackAggregates).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      null,
      { excludeAllTime: true },
    );
    expect(updateAggregates).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      null,
      { excludeAllTime: true },
    );
  });
});
