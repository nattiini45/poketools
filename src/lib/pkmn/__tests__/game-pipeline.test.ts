import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock all query imports ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/games', async () => ({
  ReplayAlreadyRecordedError: (
    await vi.importActual<typeof import('@/lib/supabase/queries/games')>('@/lib/supabase/queries/games')
  ).ReplayAlreadyRecordedError,
  findGameIdByReplayHash: vi.fn(async () => null),
  createGame: vi.fn(async (input: Record<string, unknown>) => ({ id: 'game-1', ...input })),
  createBattleStats: vi.fn(async (stats: unknown[]) => stats.map((s, i) => ({ id: `stat-${i}`, ...(s as Record<string, unknown>) }))),
  getNextGameNumber: vi.fn(async () => 1),
  getGameWinCounts: vi.fn(async () => ({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] })),
  getGameById: vi.fn(async () => ({
    id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
    replay_url: '', source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: '2026-05-21T00:00:00Z',
    exclude_all_time: false, updated_at: '2026-05-21T00:00:01.123456+00:00',
  })),
  // Default: the edit claims the lease at the version it expected.
  claimGameEditLease: vi.fn(async () => 'claimed'),
  releaseGameEditLease: vi.fn(async () => true),
  getGamesByMatch: vi.fn(async () => []),
  getBattleStatsByGame: vi.fn(async () => []),
  deleteBattleStatsByGame: vi.fn(async () => {}),
  deleteUncountedGameRow: vi.fn(async () => 'deleted'),
  updateGameWinner: vi.fn(async () => {}),
  setGameStatsLocked: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  buildGameAggregateDeltas: vi.fn(() => ({ aggregateDeltas: [], playerDeltas: [] })),
  // Default: the game was counted under the marker the test read.
  rollbackGameAggregates: vi.fn(async () => 'rolled_back'),
}));

vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  shouldExcludeFromAllTime: vi.fn(async () => false),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  enqueueAggregateJob: vi.fn(async () => {}),
  cancelAggregateJobsForGame: vi.fn(async () => 0),
  applyGameAggregatesNow: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  // Truthy: the compare-and-set write matched (null = a concurrent writer won).
  updateMatchStatus: vi.fn(async () => ({ id: 'match-1' })),
  transitionMatchStatus: vi.fn(async (id: string, t: { status: string }) => ({ id, status: t.status })),
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
  getRoundById: vi.fn(async () => ({
    id: 'round-1', tournament_id: 'tourney-1', name: 'Round 1', round_number: 1,
    best_of: 3, status: 'pending', pairings_generated: true, deadline: null,
    bracket_side: null, created_at: '', updated_at: '',
  })),
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
  // T5: rebuildRatingsForPlayers (chronological replay) is the reset's rating path.
  // recordGameResult's live rating write path is out of scope for this suite.
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
  // Read-only preflight before the reset writes anything.
  planRatingRebuild: vi.fn(async (playerIds: string[]) => ({
    order: playerIds,
    addedPlayerIds: [],
    healedGaps: [],
  })),
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
  creditMatchRealKills: vi.fn(async () => ({
    applied: ['game-1'], alreadyApplied: [], notCompleted: [], missing: [], events: [],
  })),
  // Default: the edited game was never credited (no marker).
  uncreditGameRealKills: vi.fn(async () => 'not_applied'),
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

import {
  recordGameResult, deleteGame, resetMatch, resetRound, editGame, MatchStateConflictError,
  GameChangedConcurrentlyError, GameLeftUncountedError, MatchAlreadyScheduledError,
  GameEditInProgressError, GameEditStaleError, GameNotFoundError, GameRecountedConcurrentlyError, MatchResetPartialError,
} from '../game-pipeline';
import {
  getMatchById, getMatchesByRound, hasDownstreamMatches, resetMatchFields,
  transitionMatchStatus, updateMatchStatus,
} from '@/lib/supabase/queries/matches';
import { getRoundById, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import {
  creditMatchRealKills,
  recheckEpbStages,
  uncreditGameRealKills,
} from '@/lib/match/evolution-match-evaluator';
import { applyGameAggregatesNow, cancelAggregateJobsForGame, enqueueAggregateJob } from '@/lib/match/aggregate-queue';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { hasReachedBoThreshold, validateTransition } from '@/lib/tournament/match-state';
import { checkPlayerEvolutions } from '@/lib/draft/evolution-engine';
import {
  claimGameEditLease,
  createBattleStats,
  createGame,
  deleteBattleStatsByGame,
  deleteUncountedGameRow,
  getGameById,
  getGamesByMatch,
  getBattleStatsByGame,
  getGameWinCounts,
  releaseGameEditLease,
  updateGameWinner,
  findGameIdByReplayHash,
} from '@/lib/supabase/queries/games';
import type { BoundReplay } from '@/lib/pkmn/replay-binding';
import { buildGameAggregateDeltas, rollbackGameAggregates } from '@/lib/supabase/queries/aggregates';
import { shouldExcludeFromAllTime } from '@/lib/supabase/queries/test-accounts';
import { planRatingRebuild, rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { cleanMatchChildren } from '@/lib/match/match-children';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';

const REPLAY_HASH = 'ab'.repeat(32);

/** A bound replay as `bindReplay` returns it (stats as the parser emits them). */
function boundReplay(overrides: Partial<{ url: string; hash: string; winner: string }> = {}): BoundReplay {
  return {
    url: overrides.url ?? 'https://replay.pokemonshowdown.com/gen9ou-42',
    hash: overrides.hash ?? REPLAY_HASH,
    parsed: {
      winner_ps_username: overrides.winner ?? 'bob_ps',
      players: [
        {
          ps_username: 'alice_ps',
          pokemon: [
            { pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 0, was_koed: true, moves_used: ['Thunderbolt'], turns_active: 2 },
          ],
        },
        {
          ps_username: 'bob_ps',
          pokemon: [
            { pokemon_name: 'Garchomp', was_brought: true, was_lead: true, kos_dealt: 1, was_koed: false, moves_used: ['Earthquake'], turns_active: 2 },
          ],
        },
      ],
    },
  } as unknown as BoundReplay;
}

describe('recordGameResult: replay binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the winner and stats of the bound replay and stores its hash in the game insert', async () => {
    const result = await recordGameResult({
      match_id: 'match-1',
      source: 'ps_replay',
      replay: boundReplay(),
      side_player_ids: ['player-1', 'player-2'],
      submitter_id: 'player-1',
    });

    // bob_ps (side p2 = player-2) won according to the replay.
    expect(result.game_winner_id).toBe('player-2');
    expect(findGameIdByReplayHash).toHaveBeenCalledWith(REPLAY_HASH);
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({
      winner_id: 'player-2',
      replay_url: 'https://replay.pokemonshowdown.com/gen9ou-42',
      replay_hash: REPLAY_HASH,
      source: 'ps_replay',
    }));
    expect(createBattleStats).toHaveBeenCalledWith([
      expect.objectContaining({ game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu', kos_dealt: 0, match_won: false }),
      expect.objectContaining({ game_id: 'game-1', player_id: 'player-2', pokemon_name: 'Garchomp', kos_dealt: 1, match_won: true }),
    ]);
  });

  it('follows the side assignment: swapped sides swap the winner and the stats owners', async () => {
    const result = await recordGameResult({
      match_id: 'match-1',
      source: 'ps_replay',
      replay: boundReplay(),
      side_player_ids: ['player-2', 'player-1'],
      submitter_id: 'admin-user',
      is_admin: true,
    });

    expect(result.game_winner_id).toBe('player-1');
    expect(createBattleStats).toHaveBeenCalledWith([
      expect.objectContaining({ player_id: 'player-2', pokemon_name: 'Pikachu', match_won: false }),
      expect.objectContaining({ player_id: 'player-1', pokemon_name: 'Garchomp', match_won: true }),
    ]);
  });

  it('refuses a battle already bound to a game in any match (409, nothing written)', async () => {
    vi.mocked(findGameIdByReplayHash).mockResolvedValueOnce('game-in-another-match');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(recordGameResult({
      match_id: 'match-1',
      source: 'ps_replay',
      replay: boundReplay(),
      side_player_ids: ['player-1', 'player-2'],
      submitter_id: 'player-1',
    })).rejects.toMatchObject({ name: 'ReplayAlreadyRecordedError', code: 'replay_already_recorded', statusCode: 409 });

    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(createGame).not.toHaveBeenCalled();
    expect(createBattleStats).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('refuses a replay whose log names no side as the winner (400, nothing written)', async () => {
    await expect(recordGameResult({
      match_id: 'match-1',
      source: 'ps_replay',
      replay: boundReplay({ winner: '' }),
      side_player_ids: ['player-1', 'player-2'],
      submitter_id: 'player-1',
    })).rejects.toMatchObject({ code: 'replay_winner_unknown', statusCode: 400 });
    expect(createGame).not.toHaveBeenCalled();
  });

  it('refuses a side assigned to a player outside the match', async () => {
    await expect(recordGameResult({
      match_id: 'match-1',
      source: 'ps_replay',
      replay: boundReplay(),
      side_player_ids: ['player-1', 'stranger'],
      submitter_id: 'admin-user',
      is_admin: true,
    })).rejects.toMatchObject({ code: 'match_player_not_participant', params: { playerId: 'stranger' }, statusCode: 400 });
    expect(createGame).not.toHaveBeenCalled();
  });

  it('refuses both sides assigned to the same player', async () => {
    await expect(recordGameResult({
      match_id: 'match-1',
      source: 'ps_replay',
      replay: boundReplay(),
      side_player_ids: ['player-1', 'player-1'],
      submitter_id: 'admin-user',
      is_admin: true,
    })).rejects.toMatchObject({ code: 'replay_sides_not_distinct', statusCode: 400 });
    expect(createGame).not.toHaveBeenCalled();
  });

  describe('a failure after the game insert', () => {
    const replayInput = () => ({
      match_id: 'match-1',
      source: 'ps_replay' as const,
      replay: boundReplay(),
      side_player_ids: ['player-1', 'player-2'] as [string, string],
      submitter_id: 'player-1',
    });

    it('deletes the game again when its stats insert fails, freeing the hash, and rethrows', async () => {
      const statsError = new Error('stats insert failed');
      vi.mocked(createBattleStats).mockRejectedValueOnce(statsError);

      await expect(recordGameResult(replayInput())).rejects.toBe(statsError);

      expect(createGame).toHaveBeenCalledWith(expect.objectContaining({ replay_hash: REPLAY_HASH }));
      expect(deleteUncountedGameRow).toHaveBeenCalledWith('game-1');
      expect(enqueueAggregateJob).not.toHaveBeenCalled();
      expect(transitionMatchStatus).not.toHaveBeenCalled();
    });

    it('deletes the game (and its stats, by cascade) when the aggregate job cannot be enqueued', async () => {
      const queueError = new Error('enqueue failed');
      vi.mocked(enqueueAggregateJob).mockRejectedValueOnce(queueError);

      await expect(recordGameResult(replayInput())).rejects.toBe(queueError);

      expect(createBattleStats).toHaveBeenCalled();
      expect(deleteUncountedGameRow).toHaveBeenCalledWith('game-1');
      expect(transitionMatchStatus).not.toHaveBeenCalled();
    });

    it('rethrows the original error and logs the admin game delete when the clean-up fails too', async () => {
      const statsError = new Error('stats insert failed');
      vi.mocked(createBattleStats).mockRejectedValueOnce(statsError);
      vi.mocked(deleteUncountedGameRow).mockRejectedValueOnce(new Error('delete failed'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(recordGameResult(replayInput())).rejects.toBe(statsError);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('admin game delete'),
        expect.objectContaining({ message: 'delete failed' })
      );
      errorSpy.mockRestore();
    });

    it('keeps a game whose aggregates were applied after all (fenced delete answers counted)', async () => {
      const queueError = new Error('enqueue response lost');
      vi.mocked(enqueueAggregateJob).mockRejectedValueOnce(queueError);
      vi.mocked(deleteUncountedGameRow).mockResolvedValueOnce('counted');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(recordGameResult(replayInput())).rejects.toBe(queueError);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('the game is kept'));
      errorSpy.mockRestore();
    });
  });

  it('writes no replay hash for an entered result', async () => {
    await recordGameResult({
      match_id: 'match-1',
      winner_id: 'player-1',
      source: 'manual' as const,
      battle_stats: [],
      submitter_id: 'player-1',
    });
    expect(findGameIdByReplayHash).not.toHaveBeenCalled();
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({ replay_hash: null }));
  });
});

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
        source: 'ps_replay',
        replay: boundReplay({ url: 'https://replay.pokemonshowdown.com/gen9ou-1234567890#turn-5' }),
        side_player_ids: ['player-1', 'player-2'],
        submitter_id: 'player-1',
      })
    ).rejects.toMatchObject({
      name: 'DuplicateReplayError',
      code: 'duplicate_replay',
      statusCode: 409,
    });
    expect(createGame).not.toHaveBeenCalled();
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
    // One row update carries status, winner, submitter and the timer.
    expect(transitionMatchStatus).toHaveBeenCalledTimes(1);
    expect(transitionMatchStatus).toHaveBeenCalledWith('match-1', {
      expectedStatus: 'in_progress',
      status: 'pending_confirmation',
      winnerId: 'player-1',
      submitterId: 'player-1',
      autoConfirmAt: null,
      confirmedAt: null,
    });
    expect(updateMatchStatus).not.toHaveBeenCalled();
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

    expect(transitionMatchStatus).toHaveBeenCalledWith('match-1', expect.objectContaining({
      status: 'pending_confirmation',
      autoConfirmAt: '2026-05-23T00:00:00.000Z',
      confirmedAt: null,
    }));
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
    // Counted (marker set) but without stats: one rollback RPC with empty
    // deltas, which also clears the marker.
    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(rollbackGameAggregates).toHaveBeenCalledWith('game-1', '2026-05-21T00:00:00Z', expect.any(Object));
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
    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
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
    expect(buildGameAggregateDeltas).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      null,
      { excludeAllTime: true },
    );
    expect(rollbackGameAggregates).toHaveBeenCalledWith('game-1', '2026-05-21T00:00:00Z', expect.any(Object));
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

    // EPB evolution: repairSeasonEvolution runs (whole-season rebuild, which
    // also re-syncs the per-game credit markers); no per-game debit is used.
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

    // deleteGame deletes a single game (gamesDeleted: 1). The match WAS
    // completed and is not any more (no games left), so both players' ratings
    // are rebuilt and listed, next to the EPB evolution detail + impossible
    // lineups.
    expect(result.recalculation).toBeDefined();
    expect(result.recalculation!.gamesDeleted).toBe(1);
    expect(result.recalculation!.ratingsRebuilt).toEqual({ players: ['player-1', 'player-2'] });
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

    const rejection = resetMatch('match-1', 'admin-1');
    await expect(rejection).rejects.toBeInstanceOf(MatchAlreadyScheduledError);
    await expect(rejection).rejects.toMatchObject({ code: 'match_already_scheduled', statusCode: 409 });
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

    // EPB evolution: repairSeasonEvolution runs (NOT the per-game debit
    // uncreditGameRealKills, which is mocked but must not be called from
    // resetMatch's EPB branch).
    expect(repairSeasonEvolution).toHaveBeenCalledTimes(1);
    expect(repairSeasonEvolution).toHaveBeenCalledWith('season-epb');
    expect(uncreditGameRealKills).not.toHaveBeenCalled();
    // Ratings: rebuildRatingsForPlayers replays both players chronologically.
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

  describe('a game rollback that loses a race', () => {
    const inProgress = {
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'in_progress', winner_id: null,
      player_1_name: 'Alice', player_2_name: 'Bob',
    } as ReturnType<typeof getMatchById> extends Promise<infer T> ? T : never;
    const twoGames = [
      { id: 'game-a', game_number: 1, winner_id: 'player-1' } as never,
      { id: 'game-b', game_number: 2, winner_id: 'player-1' } as never,
    ];

    it('settles every sibling, then reports how many games were already removed (409, match not reset)', async () => {
      vi.mocked(getMatchById).mockResolvedValueOnce(inProgress);
      vi.mocked(getGamesByMatch).mockResolvedValueOnce(twoGames);
      const lost = new GameChangedConcurrentlyError();
      vi.mocked(getBattleStatsByGame).mockImplementation(async (gameId: string) => {
        if (gameId === 'game-b') throw lost;
        return [];
      });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      const rejection = resetMatch('match-1', 'admin-1');
      await expect(rejection).rejects.toBeInstanceOf(MatchResetPartialError);
      await expect(rejection).rejects.toMatchObject({
        code: 'admin_match_reset_partial', statusCode: 409, params: { count: 1 },
      });

      expect(resetMatchFields).not.toHaveBeenCalled();
      expect(cleanMatchChildren).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('after 1 sibling(s) were removed'), lost);
      logged.mockRestore();
      vi.mocked(getBattleStatsByGame).mockImplementation(async () => []);
    });

    it('rethrows the first game error unchanged when no game was removed, logging every rejection', async () => {
      vi.mocked(getMatchById).mockResolvedValueOnce(inProgress);
      vi.mocked(getGamesByMatch).mockResolvedValueOnce(twoGames);
      const errors = new Map([
        ['game-a', new GameChangedConcurrentlyError()],
        ['game-b', new Error('game-b read failed')],
      ]);
      vi.mocked(getBattleStatsByGame).mockImplementation(async (gameId: string) => {
        throw errors.get(gameId);
      });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      const rejection = resetMatch('match-1', 'admin-1');
      await expect(rejection).rejects.toBe(errors.get('game-a'));
      await expect(rejection).rejects.toMatchObject({ code: 'admin_game_changed_concurrently', statusCode: 409 });
      expect(resetMatchFields).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('game rollback 1 of 2 failed and no game was removed'), errors.get('game-a'));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('game rollback 2 of 2 failed and no game was removed'), errors.get('game-b'));
      logged.mockRestore();
      vi.mocked(getBattleStatsByGame).mockImplementation(async () => []);
    });
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

  // ── H13: the rating preflight runs before the reset writes anything ──
  type ResetMatchRow = NonNullable<Awaited<ReturnType<typeof getMatchById>>>;
  const completedMatch = (overrides: Partial<ResetMatchRow> = {}): ResetMatchRow =>
    ({
      id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
      player_1_id: 'player-1', player_2_id: 'player-2',
      status: 'completed', winner_id: 'player-1',
      player_1_name: 'Alice', player_2_name: 'Bob',
      ...overrides,
    }) as ResetMatchRow;

  it('plans the rating rebuild before any write, excluding the match being reset', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(completedMatch());

    await resetMatch('match-1', 'admin-1');

    expect(planRatingRebuild).toHaveBeenCalledTimes(1);
    expect(planRatingRebuild).toHaveBeenCalledWith(['player-1', 'player-2'], {
      excludeMatchIds: ['match-1'],
    });
    const planOrder = vi.mocked(planRatingRebuild).mock.invocationCallOrder[0];
    expect(planOrder).toBeLessThan(vi.mocked(getGamesByMatch).mock.invocationCallOrder[0]);
    expect(planOrder).toBeLessThan(vi.mocked(cleanMatchChildren).mock.invocationCallOrder[0]);
    expect(planOrder).toBeLessThan(vi.mocked(resetMatchFields).mock.invocationCallOrder[0]);
  });

  it('a refused rating plan aborts the reset with nothing written (match stays completed, retry possible)', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(completedMatch());
    const refusal = new UserFacingError('Rating history has gaps that no rebuild order can fill', {
      code: 'rating_history_incomplete',
      params: { count: 2, players: 'Alice, Bob' },
      status: 409,
    });
    vi.mocked(planRatingRebuild).mockRejectedValueOnce(refusal);

    await expect(resetMatch('match-1', 'admin-1')).rejects.toBe(refusal);

    expect(getGamesByMatch).not.toHaveBeenCalled();
    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(cleanMatchChildren).not.toHaveBeenCalled();
    expect(resetMatchFields).not.toHaveBeenCalled();
    expect(rebuildRatingsForPlayers).not.toHaveBeenCalled();
    expect(recomputeStreaks).not.toHaveBeenCalled();
    expect(repairSeasonEvolution).not.toHaveBeenCalled();
  });

  it('skips the rating preflight for a match that was not completed', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(
      completedMatch({ status: 'in_progress', winner_id: null })
    );

    await resetMatch('match-1', 'admin-1');

    expect(planRatingRebuild).not.toHaveBeenCalled();
    expect(rebuildRatingsForPlayers).not.toHaveBeenCalled();
  });

  it('lists every player the rating batch rebuilt, including players added to heal gaps', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(completedMatch());
    vi.mocked(rebuildRatingsForPlayers).mockResolvedValueOnce([
      { playerId: 'player-3', addedToBatch: true, matchesReplayed: 4, ratingBefore: 1500, ratingAfter: 1510, unratedMatchIds: [], changed: true },
      { playerId: 'player-1', addedToBatch: false, matchesReplayed: 3, ratingBefore: 1500, ratingAfter: 1490, unratedMatchIds: [], changed: true },
      { playerId: 'player-2', addedToBatch: false, matchesReplayed: 2, ratingBefore: 1500, ratingAfter: 1505, unratedMatchIds: [], changed: true },
    ]);

    const result = await resetMatch('match-1', 'admin-1');

    expect(result.recalculation!.ratingsRebuilt).toEqual({
      players: ['player-3', 'player-1', 'player-2'],
    });
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

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(1);
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

    // Should still re-apply aggregates, atomically with the marker
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(1);
    expect(applyGameAggregatesNow).toHaveBeenCalledWith('game-1', expect.any(String), null, expect.any(Object));
    expect(result.match_status).toBeDefined();
  });

  it('does not roll back aggregates when the original queued job was not applied', async () => {
    const unapplied = {
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false, aggregate_applied_at: null,
      exclude_all_time: false,
    } as Awaited<ReturnType<typeof getGameById>>;
    // Read before and after the job cancel.
    vi.mocked(getGameById).mockResolvedValueOnce(unapplied).mockResolvedValueOnce(unapplied);
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

    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(1);
  });

  it('reads the persisted exclude_all_time flag for both rollback and re-apply (does not recompute)', async () => {
    // Game row carries exclude_all_time=true (frozen at creation) with applied
    // aggregates, so editGame must roll back the old stats AND re-apply the new
    // stats using that persisted flag verbatim — even though
    // shouldExcludeFromAllTime (the create-time computation) would now return
    // false here, proving the hot path no longer recomputes the gate at read
    // time. editGame reads the game before and after the job cancel.
    const frozen = {
      id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
      replay_url: '', source: 'manual', parsed: true, stats_locked: false,
      aggregate_applied_at: '2026-05-21T00:00:00Z', exclude_all_time: true,
    } as Awaited<ReturnType<typeof getGameById>>;
    vi.mocked(getGameById).mockResolvedValueOnce(frozen).mockResolvedValueOnce(frozen);
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
    // Rollback deltas and re-apply deltas both built with the frozen flag.
    expect(buildGameAggregateDeltas).toHaveBeenCalledTimes(2);
    expect(rollbackGameAggregates).toHaveBeenCalledWith('game-1', '2026-05-21T00:00:00Z', expect.any(Object));
    expect(buildGameAggregateDeltas).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      null,
      { excludeAllTime: true },
    );
  });
});

describe('editGame / deleteGame: atomic, fenced aggregate rollback', () => {
  const MARKER = '2026-05-21T00:00:00Z';
  const stat = {
    id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu', was_brought: true,
    was_lead: true, kos_dealt: 2, was_koed: false, moves_used: ['Thunderbolt'], turns_active: 5,
    match_won: true, created_at: '',
  };
  const gameRow = (appliedAt: string | null) => ({
    id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
    replay_url: '', source: 'manual', parsed: true, stats_locked: false,
    aggregate_applied_at: appliedAt, exclude_all_time: false,
  }) as Awaited<ReturnType<typeof getGameById>>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('editGame rolls back a game the queue applied between its first read and the cancel (no double count)', async () => {
    // First read: not applied yet. The queue job commits, then the cancel
    // finds nothing to cancel; the re-read sees the marker.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(rollbackGameAggregates).toHaveBeenCalledWith('game-1', MARKER, expect.any(Object));
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(1);
    // The marker read that decides the rollback comes after the cancel.
    const cancelOrder = vi.mocked(cancelAggregateJobsForGame).mock.invocationCallOrder[0];
    const readOrders = vi.mocked(getGameById).mock.invocationCallOrder;
    expect(readOrders[1]).toBeGreaterThan(cancelOrder);
  });

  it('editGame rolls back (decrements + marker clear, one RPC fenced on the marker it read) before re-applying', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const oldDeltas = { aggregateDeltas: [], playerDeltas: [] };
    vi.mocked(buildGameAggregateDeltas).mockReturnValueOnce(oldDeltas);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(rollbackGameAggregates).toHaveBeenCalledWith('game-1', MARKER, oldDeltas);
    const rollbackOrder = vi.mocked(rollbackGameAggregates).mock.invocationCallOrder[0];
    const applyOrder = vi.mocked(applyGameAggregatesNow).mock.invocationCallOrder[0];
    expect(applyOrder).toBeGreaterThan(rollbackOrder);
    // Nothing to heal on success.
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('editGame re-queues the game when the re-apply fails after the rollback, then rethrows the original error', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('upsert failed');
    vi.mocked(applyGameAggregatesNow).mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1' })).rejects.toBe(err);

    expect(enqueueAggregateJob).toHaveBeenCalledWith('game-1', 'tourney-1', null);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('edit failed for game game-1'), err);
    logged.mockRestore();
  });

  it('editGame re-queues the game when a stats write fails between rollback and re-apply', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('insert failed');
    vi.mocked(createBattleStats).mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      editGame({ game_id: 'game-1', admin_id: 'admin-1', battle_stats: [{ player_id: 'player-1', pokemon_name: 'Pikachu' }] })
    ).rejects.toBe(err);

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).toHaveBeenCalledWith('game-1', 'tourney-1', null);
    logged.mockRestore();
  });

  it('editGame answers admin_game_left_uncounted, carrying both errors, when the re-queue fails too', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('apply failed');
    const requeueErr = new Error('insert job failed');
    vi.mocked(applyGameAggregatesNow).mockRejectedValueOnce(err);
    vi.mocked(enqueueAggregateJob).mockRejectedValueOnce(requeueErr);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const rejection = editGame({ game_id: 'game-1', admin_id: 'admin-1' });
    await expect(rejection).rejects.toBeInstanceOf(GameLeftUncountedError);
    await expect(rejection).rejects.toMatchObject({
      code: 'admin_game_left_uncounted',
      statusCode: 500,
      gameId: 'game-1',
      editError: err,
      requeueError: requeueErr,
    });

    // The edit's own failure is logged before the re-queue is attempted.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('edit failed for game game-1'), err);
    logged.mockRestore();
  });

  it('editGame rethrows its own error, not admin_game_left_uncounted, when the re-queue failed because the game is gone', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER))
      // Existence check after the failed re-queue: deleted concurrently.
      .mockResolvedValueOnce(null);
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('insert or update on table "battle_stats" violates foreign key constraint');
    vi.mocked(createBattleStats).mockRejectedValueOnce(err);
    vi.mocked(enqueueAggregateJob).mockRejectedValueOnce(new Error('aggregate_jobs_game_id_fkey'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      editGame({ game_id: 'game-1', admin_id: 'admin-1', battle_stats: [{ player_id: 'player-1', pokemon_name: 'Pikachu' }] })
    ).rejects.toBe(err);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining('the game is gone'), expect.any(Error));
    logged.mockRestore();
  });

  it('editGame answers 409 with nothing written when a concurrent edit re-applied the game (marker_changed)', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(rollbackGameAggregates).mockResolvedValueOnce('marker_changed');

    const rejection = editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' });
    await expect(rejection).rejects.toBeInstanceOf(GameChangedConcurrentlyError);
    await expect(rejection).rejects.toMatchObject({ code: 'admin_game_changed_concurrently', statusCode: 409 });

    expect(updateGameWinner).not.toHaveBeenCalled();
    expect(deleteBattleStatsByGame).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    // The winner of the race owns the count: no re-queue.
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('editGame answers 409 with nothing written when a concurrent edit already rolled the game back (not_applied)', async () => {
    // Both edits read the marker as set; the other edit's rollback committed
    // first, so this call's fenced RPC finds the marker NULL.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(rollbackGameAggregates).mockResolvedValueOnce('not_applied');

    const rejection = editGame({
      game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2',
      battle_stats: [{ player_id: 'player-1', pokemon_name: 'Pikachu' }],
    });
    await expect(rejection).rejects.toBeInstanceOf(GameChangedConcurrentlyError);
    await expect(rejection).rejects.toMatchObject({ code: 'admin_game_changed_concurrently', statusCode: 409 });

    // No stats write interleaves with the winner's, no apply, no stats lock, no re-queue.
    expect(updateGameWinner).not.toHaveBeenCalled();
    expect(deleteBattleStatsByGame).not.toHaveBeenCalled();
    expect(createBattleStats).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('editGame reports a game deleted between its read and its rollback as not found (404, nothing written, no re-queue)', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(rollbackGameAggregates).mockResolvedValueOnce('game_missing');

    const rejection = editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' });
    await expect(rejection).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(rejection).rejects.toMatchObject({ code: 'game_not_found', statusCode: 404 });

    expect(updateGameWinner).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('editGame claims the lease at the version the editor loaded before it cancels, reads or writes anything, and releases it last', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1', expected_updated_at: '2026-10-19T08:00:00.5+00:00' });

    expect(claimGameEditLease).toHaveBeenCalledWith('game-1', '2026-10-19T08:00:00.5+00:00', expect.any(String));
    const token = vi.mocked(claimGameEditLease).mock.calls[0][2];
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    const claimOrder = vi.mocked(claimGameEditLease).mock.invocationCallOrder[0];
    expect(vi.mocked(cancelAggregateJobsForGame).mock.invocationCallOrder[0]).toBeGreaterThan(claimOrder);
    // Released with the same token, after the last write of the edit.
    expect(releaseGameEditLease).toHaveBeenCalledTimes(1);
    expect(releaseGameEditLease).toHaveBeenCalledWith('game-1', token);
    expect(vi.mocked(releaseGameEditLease).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(applyGameAggregatesNow).mock.invocationCallOrder[0],
    );
  });

  it('editGame releases its lease when the edit fails, and the edit error is the one thrown', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const boom = new Error('apply failed');
    vi.mocked(applyGameAggregatesNow).mockRejectedValueOnce(boom);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' })).rejects.toBe(boom);

    const token = vi.mocked(claimGameEditLease).mock.calls[0][2];
    expect(releaseGameEditLease).toHaveBeenCalledWith('game-1', token);
    errSpy.mockRestore();
  });

  it('editGame keeps a saved edit when the lease release fails, and logs the failure', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const releaseError = new Error('release failed');
    vi.mocked(releaseGameEditLease).mockRejectedValueOnce(releaseError);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' });

    expect(result.match_status).toBeDefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('could not release the edit lease of game game-1'), releaseError);
    errSpy.mockRestore();
  });

  it('editGame logs a lease that was no longer held at release (expired and taken over)', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(releaseGameEditLease).mockResolvedValueOnce(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' });

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('edit lease of game game-1 was no longer held at release'));
    errSpy.mockRestore();
  });

  it('editGame answers 409 admin_game_edit_in_progress and writes nothing while another edit holds the lease (reloaded editor)', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(claimGameEditLease).mockResolvedValueOnce('leased');

    const rejection = editGame({
      game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2', expected_updated_at: '2026-10-19T08:00:00Z',
    });
    await expect(rejection).rejects.toBeInstanceOf(GameEditInProgressError);
    await expect(rejection).rejects.toMatchObject({ code: 'admin_game_edit_in_progress', statusCode: 409 });

    expect(cancelAggregateJobsForGame).not.toHaveBeenCalled();
    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(updateGameWinner).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    // The refused edit holds no lease, so it releases nothing.
    expect(releaseGameEditLease).not.toHaveBeenCalled();
  });

  it('editGame without an expected version claims the version it read first', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce({ ...gameRow(MARKER)!, updated_at: '2026-10-19T09:00:00+00:00' })
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(claimGameEditLease).toHaveBeenCalledWith('game-1', '2026-10-19T09:00:00+00:00', expect.any(String));
  });

  it('editGame answers 409 admin_game_edit_stale and writes nothing when the version moved on (double submit, second admin)', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(claimGameEditLease).mockResolvedValueOnce('stale');

    const rejection = editGame({
      game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2', expected_updated_at: '2026-10-19T08:00:00Z',
    });
    await expect(rejection).rejects.toBeInstanceOf(GameEditStaleError);
    await expect(rejection).rejects.toMatchObject({ code: 'admin_game_edit_stale', statusCode: 409 });

    expect(cancelAggregateJobsForGame).not.toHaveBeenCalled();
    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(updateGameWinner).not.toHaveBeenCalled();
    expect(deleteBattleStatsByGame).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('editGame answers 404 when the game is gone at the claim', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(claimGameEditLease).mockResolvedValueOnce('missing');

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' })).rejects.toMatchObject({
      code: 'game_not_found',
      statusCode: 404,
    });
    expect(cancelAggregateJobsForGame).not.toHaveBeenCalled();
  });

  it('editGame rolls back a counted game without stats too (clears its marker in the same RPC)', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([]);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    // No stats: nothing to count, no apply.
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
  });

  it('editGame aborts before touching aggregates when the cancel fails', async () => {
    vi.mocked(getGameById).mockResolvedValueOnce(gameRow(MARKER));
    const err = new Error('cancel failed');
    vi.mocked(cancelAggregateJobsForGame).mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1' })).rejects.toBe(err);

    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(applyGameAggregatesNow).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('editGame reports a game deleted between the cancel and the re-read as not found (no re-queue)', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(null);

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1' })).rejects.toThrow('Game not found');
    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('deleteGame decides the rollback from the marker read after the cancel', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await deleteGame('game-1', 'admin-1');

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(rollbackGameAggregates).toHaveBeenCalledWith('game-1', MARKER, expect.any(Object));
    const cancelOrder = vi.mocked(cancelAggregateJobsForGame).mock.invocationCallOrder[0];
    expect(vi.mocked(getGameById).mock.invocationCallOrder[1]).toBeGreaterThan(cancelOrder);
  });

  it('deleteGame rolls back (with the marker clear, one RPC) before the fenced delete of the game and its stats', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await deleteGame('game-1', 'admin-1');

    const rollbackOrder = vi.mocked(rollbackGameAggregates).mock.invocationCallOrder[0];
    expect(vi.mocked(deleteUncountedGameRow).mock.invocationCallOrder[0]).toBeGreaterThan(rollbackOrder);
    // One statement: the stats go with the game row (ON DELETE CASCADE).
    expect(deleteBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('deleteGame answers 409 when a concurrent edit re-applied the uncounted game before the delete (fenced delete removes nothing)', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    // Both reads see the game uncounted (marker NULL), then the edit re-applies.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(null));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(deleteUncountedGameRow).mockResolvedValueOnce('counted');

    const rejection = deleteGame('game-1', 'admin-1');
    // Its own code: the game still exists and is counted (the message must not claim "nothing changed").
    await expect(rejection).rejects.toBeInstanceOf(GameRecountedConcurrentlyError);
    await expect(rejection).rejects.toMatchObject({ code: 'admin_game_delete_recounted', statusCode: 409 });

    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(deleteBattleStatsByGame).not.toHaveBeenCalled();
    // Counted by the concurrent edit: nothing to re-queue.
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('deleteGame answers admin_game_delete_recounted when an edit re-counted the game after this delete rolled it back', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(deleteUncountedGameRow).mockResolvedValueOnce('counted');

    await expect(deleteGame('game-1', 'admin-1')).rejects.toMatchObject({ code: 'admin_game_delete_recounted' });
    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
  });

  it('deleteGame treats a game deleted concurrently before its rollback as deleted (no fenced delete, no re-queue)', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(rollbackGameAggregates).mockResolvedValueOnce('game_missing');

    await expect(deleteGame('game-1', 'admin-1')).resolves.toBeDefined();
    expect(deleteUncountedGameRow).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('deleteGame treats a game deleted concurrently between the read and the delete as deleted', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(null));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(deleteUncountedGameRow).mockResolvedValueOnce('missing');

    await expect(deleteGame('game-1', 'admin-1')).resolves.toBeDefined();
  });

  it('deleteGame answers 409 and deletes nothing when a concurrent edit re-applied the game', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(rollbackGameAggregates).mockResolvedValueOnce('marker_changed');

    await expect(deleteGame('game-1', 'admin-1')).rejects.toBeInstanceOf(GameChangedConcurrentlyError);

    expect(deleteBattleStatsByGame).not.toHaveBeenCalled();
    expect(deleteUncountedGameRow).not.toHaveBeenCalled();
  });

  it('a deleteGame retried after a failed delete does not roll the game back a second time', async () => {
    // Attempt 1: rollback + marker clear commit together, then the game-row delete fails.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('delete failed');
    vi.mocked(deleteUncountedGameRow).mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(deleteGame('game-1', 'admin-1')).rejects.toBe(err);
    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    // The rolled-back game is re-queued, so the queue counts it again while it exists.
    expect(enqueueAggregateJob).toHaveBeenCalledWith('game-1', 'tourney-1', null);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('delete failed for game game-1'), err);
    logged.mockRestore();

    // Attempt 2: the database now holds the cleared marker.
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(null));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await deleteGame('game-1', 'admin-1');

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(deleteUncountedGameRow).toHaveBeenCalledTimes(2);
  });

  it('a deleteGame retried after a lost rollback response reads the cleared marker and does not roll back again', async () => {
    // Attempt 1: the rollback committed but its response was lost.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const lost = new Error('fetch timed out');
    vi.mocked(rollbackGameAggregates).mockRejectedValueOnce(lost);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(deleteGame('game-1', 'admin-1')).rejects.toBe(lost);
    expect(enqueueAggregateJob).toHaveBeenCalledTimes(1);
    expect(deleteUncountedGameRow).not.toHaveBeenCalled();

    // Attempt 2: the cancel removes the re-queued job, the read sees the marker NULL.
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(null));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await deleteGame('game-1', 'admin-1');

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(deleteUncountedGameRow).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it('a deleteGame that loses the rollback race to a concurrent delete answers 409 and deletes nothing (not_applied)', async () => {
    // Both deletes read the marker as set; the other one's rollback committed first.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    vi.mocked(rollbackGameAggregates).mockResolvedValueOnce('not_applied');

    const rejection = deleteGame('game-1', 'admin-1');
    await expect(rejection).rejects.toBeInstanceOf(GameChangedConcurrentlyError);
    await expect(rejection).rejects.toMatchObject({ code: 'admin_game_changed_concurrently', statusCode: 409 });

    expect(deleteUncountedGameRow).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
  });

  it('deleteGame answers admin_game_left_uncounted when the delete and its re-queue both fail while the game exists', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(null)); // existence check: still there
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('delete failed');
    const requeueErr = new Error('insert job failed');
    vi.mocked(deleteUncountedGameRow).mockRejectedValueOnce(err);
    vi.mocked(enqueueAggregateJob).mockRejectedValueOnce(requeueErr);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(deleteGame('game-1', 'admin-1')).rejects.toMatchObject({
      code: 'admin_game_left_uncounted',
      statusCode: 500,
      editError: err,
      requeueError: requeueErr,
    });
    logged.mockRestore();
  });

  it('editGame re-applies through the atomic apply with the persisted scope flag, never a separate marker write', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const deltas = { aggregateDeltas: [], playerDeltas: [] };
    vi.mocked(buildGameAggregateDeltas).mockReturnValue(deltas);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(buildGameAggregateDeltas).toHaveBeenCalledWith([stat], 'tourney-1', null, { excludeAllTime: false });
    expect(applyGameAggregatesNow).toHaveBeenCalledWith('game-1', 'tourney-1', null, deltas);
    vi.mocked(buildGameAggregateDeltas).mockReturnValue({ aggregateDeltas: [], playerDeltas: [] });
  });

  it('an editGame retried after the apply response was lost (committed) rolls back once per counted application (twice across the two attempts)', async () => {
    // Attempt 1: the atomic apply committed (marker set) but the response was lost.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const timeout = new Error('fetch timed out');
    vi.mocked(applyGameAggregatesNow).mockRejectedValueOnce(timeout);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1' })).rejects.toBe(timeout);

    // Attempt 2: marker and increments committed together, so the retry sees
    // the new marker and rolls that application back exactly once before
    // re-applying.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow('2026-10-18T00:00:00Z'))
      .mockResolvedValueOnce(gameRow('2026-10-18T00:00:00Z'));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(2);
    expect(rollbackGameAggregates).toHaveBeenLastCalledWith('game-1', '2026-10-18T00:00:00Z', expect.any(Object));
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it('an editGame retried after the apply failed without committing does not roll back again', async () => {
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(MARKER))
      .mockResolvedValueOnce(gameRow(MARKER));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);
    const err = new Error('apply failed');
    vi.mocked(applyGameAggregatesNow).mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1' })).rejects.toBe(err);
    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);

    // Nothing committed: the marker is still the NULL the rollback wrote.
    vi.mocked(getGameById)
      .mockResolvedValueOnce(gameRow(null))
      .mockResolvedValueOnce(gameRow(null));
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([stat]);

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(rollbackGameAggregates).toHaveBeenCalledTimes(1);
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe('editGame: EPB evolution recheck failure is reported, never an empty success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGameWinCounts).mockResolvedValue({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
  });

  it('returns evolution_recheck_failed with the change saved when the EPB recheck throws', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', season_format_type: 'evolution_point_buy',
    } as Awaited<ReturnType<typeof getTournamentById>>);
    const err = new Error('tracker read failed');
    vi.mocked(uncreditGameRealKills).mockRejectedValueOnce(err);
    vi.mocked(getBattleStatsByGame).mockResolvedValueOnce([
      {
        id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Pikachu', was_brought: true,
        was_lead: true, kos_dealt: 2, was_koed: false, moves_used: [], turns_active: 5, match_won: true, created_at: '',
      },
    ]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(result.evolution_recheck_failed).toBe(true);
    expect(applyGameAggregatesNow).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('EPB evolution recheck failed for season season-epb'), err);
    logged.mockRestore();
  });

  it('omits the flag when the recheck succeeds', async () => {
    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });
    expect(result).not.toHaveProperty('evolution_recheck_failed');
  });
});

// ─── EPB real kills wait for the confirmed result ─────────────────────

const EPB_TOURNAMENT = {
  id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
  name: 'EvoLiga', best_of_default: 3, season_format_type: 'evolution_point_buy',
} as unknown as Awaited<ReturnType<typeof getTournamentById>>;

describe('recordGameResult: EPB progress waits for the confirmed result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('credits no evolution progress at submission, while aggregates are still enqueued', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(EPB_TOURNAMENT);
    // The submission reaches the Bo threshold: the match goes to pending_confirmation.
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 1 });

    const result = await recordGameResult({
      ...baseInput,
      battle_stats: [
        {
          game_id: '', player_id: 'player-1', pokemon_name: 'Charmander', was_brought: true, was_lead: true,
          kos_dealt: 3, was_koed: false, moves_used: [], turns_active: 4,
        },
      ],
    });

    expect(result.match_status).toBe('pending_confirmation');
    expect(result.evolution_events).toEqual([]);
    expect(creditMatchRealKills).not.toHaveBeenCalled();
    expect(recheckEpbStages).not.toHaveBeenCalled();
    expect(checkPlayerEvolutions).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).toHaveBeenCalledWith('game-1', 'tourney-1', 'season-epb');
  });
});

describe('editGame: EPB real-kill debit and credit', () => {
  const credited = {
    id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'player-1',
    replay_url: '', source: 'manual', parsed: true, stats_locked: false,
    aggregate_applied_at: '2026-05-21T00:00:00Z',
    evolution_applied_at: '2026-05-21T00:05:00Z',
    exclude_all_time: false, updated_at: '2026-05-21T00:00:01.123456+00:00',
  } as unknown as Awaited<ReturnType<typeof getGameById>>;
  const oldStat = {
    id: 's1', game_id: 'game-1', player_id: 'player-1', pokemon_name: 'Charmander', was_brought: true,
    was_lead: true, kos_dealt: 3, was_koed: false, moves_used: [], turns_active: 5, match_won: true, created_at: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGameWinCounts).mockResolvedValue({ player_1_wins: 2, player_2_wins: 0, player_ids: ['p1', 'p2'] as [string, string] });
    vi.mocked(hasReachedBoThreshold).mockReturnValue({ reached: true, winner_id_index: 1 });
    vi.mocked(getTournamentById).mockResolvedValue(EPB_TOURNAMENT);
    vi.mocked(getGameById).mockResolvedValue(credited);
    vi.mocked(getBattleStatsByGame).mockResolvedValue([oldStat]);
    vi.mocked(uncreditGameRealKills).mockResolvedValue('rolled_back');
  });

  afterEach(() => {
    // Back to the module factories' defaults for the suites below.
    for (const mock of [
      hasReachedBoThreshold, getGameWinCounts, getTournamentById, getGameById, getBattleStatsByGame,
      uncreditGameRealKills, getMatchById,
    ]) {
      vi.mocked(mock).mockReset();
    }
  });

  it('debits a credited game by its old stats, fenced on the marker read before the edit, and credits nothing while the match is not completed', async () => {
    vi.mocked(getMatchById)
      .mockResolvedValueOnce({ ...matchWithStatus('completed'), winner_id: 'player-1' } as MatchRow)
      // The re-read after the debit: the edit moved the match to pending_confirmation.
      .mockResolvedValueOnce({ ...matchWithStatus('pending_confirmation'), winner_id: 'player-1' } as MatchRow);

    const result = await editGame({
      game_id: 'game-1',
      admin_id: 'admin-1',
      battle_stats: [{ player_id: 'player-1', pokemon_name: 'Charmander', kos_dealt: 1 }],
    } as Parameters<typeof editGame>[0]);

    expect(result.match_status).toBe('pending_confirmation');
    expect(uncreditGameRealKills).toHaveBeenCalledTimes(1);
    expect(uncreditGameRealKills).toHaveBeenCalledWith('season-epb', credited, [oldStat]);
    // The edited stats wait for the next completion.
    expect(creditMatchRealKills).not.toHaveBeenCalled();
    expect(recheckEpbStages).toHaveBeenCalledWith('season-epb', ['player-1', 'player-2']);
    expect(result).not.toHaveProperty('evolution_recheck_failed');
  });

  it('credits the edited stats when a concurrent confirm completed the match during the edit', async () => {
    vi.mocked(getMatchById)
      .mockResolvedValueOnce({ ...matchWithStatus('pending_confirmation') } as MatchRow)
      // Step 6 lost its compare-and-set: the status the confirm left …
      .mockResolvedValueOnce({ ...matchWithStatus('completed'), winner_id: 'player-1' } as MatchRow)
      // … and the re-read after the debit.
      .mockResolvedValueOnce({ ...matchWithStatus('completed'), winner_id: 'player-1' } as MatchRow);
    vi.mocked(transitionMatchStatus).mockResolvedValueOnce(null);
    vi.mocked(getRoundById).mockResolvedValueOnce(round({ round_number: 6 }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(result.match_status).toBe('completed');
    expect(creditMatchRealKills).toHaveBeenCalledWith({
      seasonId: 'season-epb',
      matchday: 6,
      playerIds: ['player-1', 'player-2'],
      gameIds: ['game-1'],
      statsByGame: { 'game-1': [oldStat] },
    });
    expect(result).not.toHaveProperty('evolution_recheck_failed');
    logged.mockRestore();
  });

  it('flags the result when the debit lost a marker race', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...matchWithStatus('completed'), winner_id: 'player-1' } as MatchRow);
    vi.mocked(uncreditGameRealKills).mockResolvedValueOnce('marker_changed');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(result.evolution_recheck_failed).toBe(true);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('were not debited after its edit (marker_changed)'));
    logged.mockRestore();
  });

  /**
   * Edit-vs-confirm race on a completed match. An in-memory model of the rows
   * the race touches (match status, the game's evolution marker, the tracker's
   * real kills) backs the mocks, and the opponent's confirm (status ->
   * completed, then finalize's per-game credit) is injected at one point of
   * the edit. Old stats: 3 KOs (credited); edited stats: 1 KO.
   */
  function modelEditConfirmRace(confirmAt: 'after_status_change' | 'after_debit') {
    const db = {
      status: 'completed' as string,
      marker: credited!.evolution_applied_at as string | null,
      kills: oldStat.kos_dealt,
      stats: [oldStat] as Array<{ kos_dealt: number }>,
    };
    const sum = (stats: ReadonlyArray<{ kos_dealt?: number }>) => stats.reduce((n, s) => n + (s.kos_dealt ?? 0), 0);
    /** The confirm and its finalize credit (`creditGameKills` semantics) with the stats in the table now. */
    const confirmAndFinalize = () => {
      db.status = 'completed';
      if (db.marker === null) {
        db.kills += sum(db.stats);
        db.marker = 'finalize-credit';
      }
    };

    vi.mocked(getMatchById).mockImplementation(async () => (
      { ...matchWithStatus(db.status), winner_id: 'player-1' } as MatchRow
    ));
    vi.mocked(createBattleStats).mockImplementationOnce(async (rows) => {
      db.stats = rows as Array<{ kos_dealt: number }>;
      return rows.map((r, i) => ({ id: `stat-${i}`, ...r })) as Awaited<ReturnType<typeof createBattleStats>>;
    });
    vi.mocked(transitionMatchStatus).mockImplementationOnce(async (id, t) => {
      db.status = t.status;
      if (confirmAt === 'after_status_change') confirmAndFinalize();
      return { id, status: t.status } as Awaited<ReturnType<typeof transitionMatchStatus>>;
    });
    vi.mocked(uncreditGameRealKills).mockImplementationOnce(async (_season, game, stats) => {
      if (db.marker === null) return 'not_applied';
      if (db.marker !== game.evolution_applied_at) return 'marker_changed';
      db.kills = Math.max(0, db.kills - sum(stats));
      db.marker = null;
      if (confirmAt === 'after_debit') confirmAndFinalize();
      return 'rolled_back';
    });
    vi.mocked(creditMatchRealKills).mockImplementationOnce(async (input) => {
      const result = { applied: [] as string[], alreadyApplied: [] as string[], notCompleted: [] as string[], missing: [], events: [] };
      if (db.status !== 'completed') result.notCompleted.push('game-1');
      else if (db.marker !== null) result.alreadyApplied.push('game-1');
      else {
        db.kills += sum(input.statsByGame['game-1'] ?? []);
        db.marker = 'edit-credit';
        result.applied.push('game-1');
      }
      return result;
    });
    return db;
  }

  it('regression: a confirm landing between the status change and the debit keeps the edited kills credited', async () => {
    const db = modelEditConfirmRace('after_status_change');

    const result = await editGame({
      game_id: 'game-1',
      admin_id: 'admin-1',
      battle_stats: [{ player_id: 'player-1', pokemon_name: 'Charmander', kos_dealt: 1 }],
    } as Parameters<typeof editGame>[0]);

    // The match is completed and holds exactly the edited game's kills, once.
    expect(db.status).toBe('completed');
    expect(db.marker).toBe('edit-credit');
    expect(db.kills).toBe(1);
    expect(uncreditGameRealKills).toHaveBeenCalledTimes(1);
    expect(creditMatchRealKills).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('evolution_recheck_failed');
  });

  it('regression: a confirm landing after the debit is credited once by its finalize, not again by the edit', async () => {
    const db = modelEditConfirmRace('after_debit');

    const result = await editGame({
      game_id: 'game-1',
      admin_id: 'admin-1',
      battle_stats: [{ player_id: 'player-1', pokemon_name: 'Charmander', kos_dealt: 1 }],
    } as Parameters<typeof editGame>[0]);

    expect(db.status).toBe('completed');
    expect(db.marker).toBe('finalize-credit');
    expect(db.kills).toBe(1);
    expect(result).not.toHaveProperty('evolution_recheck_failed');
  });
});

// ─── Match finalize integrity: game-number race, one status+timer write,
// round read fails closed before any write ──────────────────────────────

type MatchRow = Awaited<ReturnType<typeof getMatchById>>;
type RoundRow = Awaited<ReturnType<typeof getRoundById>>;

const baseInput = {
  match_id: 'match-1',
  winner_id: 'player-1',
  source: 'manual' as const,
  battle_stats: [],
  submitter_id: 'player-1',
};

function matchWithStatus(status: string): MatchRow {
  return {
    id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
    player_1_id: 'player-1', player_2_id: 'player-2',
    status, winner_id: status === 'pending_confirmation' ? 'player-2' : null,
    player_1_name: 'Alice', player_2_name: 'Bob',
    games: [],
  } as unknown as MatchRow;
}

function round(overrides: Partial<NonNullable<RoundRow>> = {}): RoundRow {
  return {
    id: 'round-1', tournament_id: 'tourney-1', name: 'Round 1', round_number: 1,
    best_of: 3, status: 'pending', pairings_generated: true, deadline: null,
    bracket_side: null, created_at: '', updated_at: '',
    ...overrides,
  } as RoundRow;
}

describe('recordGameResult: round read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects with the read error and writes nothing when the round read fails', async () => {
    const err = new Error('rounds read failed');
    vi.mocked(getRoundById).mockRejectedValueOnce(err);

    await expect(recordGameResult(baseInput)).rejects.toBe(err);

    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(createGame).not.toHaveBeenCalled();
    expect(createBattleStats).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
    expect(transitionMatchStatus).not.toHaveBeenCalled();
    expect(hasReachedBoThreshold).not.toHaveBeenCalled();
  });

  it('rejects when the round row is missing instead of assuming Bo1', async () => {
    vi.mocked(getRoundById).mockResolvedValueOnce(null);

    await expect(recordGameResult(baseInput)).rejects.toThrow('Round round-1 not found');

    expect(createGame).not.toHaveBeenCalled();
    expect(hasReachedBoThreshold).not.toHaveBeenCalled();
  });

  it('reads the round before starting a scheduled match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('scheduled'));
    vi.mocked(getRoundById).mockRejectedValueOnce(new Error('rounds read failed'));

    await expect(recordGameResult(baseInput)).rejects.toThrow('rounds read failed');

    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('reads the tournament before starting a scheduled match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('scheduled'));
    vi.mocked(getTournamentById).mockResolvedValueOnce(null);

    await expect(recordGameResult(baseInput)).rejects.toThrow('Tournament not found');

    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(createGame).not.toHaveBeenCalled();
  });

  it('decides the Bo threshold with the round best_of', async () => {
    vi.mocked(getRoundById).mockResolvedValueOnce(round({ best_of: 5 }));

    await recordGameResult(baseInput);

    expect(hasReachedBoThreshold).toHaveBeenCalledWith(5, 1, 0);
  });

  it('applies no EPB progress at submission (it waits for the completed match)', async () => {
    vi.mocked(getRoundById).mockResolvedValueOnce(round({ round_number: 4 }));
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-epb', ruleset_id: null,
      name: 'Test', best_of_default: 3, season_format_type: 'evolution_point_buy',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);

    await recordGameResult(baseInput);

    expect(creditMatchRealKills).not.toHaveBeenCalled();
    expect(checkPlayerEvolutions).not.toHaveBeenCalled();
  });
});

describe('recordGameResult: concurrent submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a scheduled match with a compare-and-set on scheduled', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('scheduled'));

    const result = await recordGameResult(baseInput);

    expect(updateMatchStatus).toHaveBeenCalledWith(
      'match-1', 'in_progress', undefined, undefined, undefined, 'scheduled'
    );
    expect(result.match_status).toBe('in_progress');
  });

  it('proceeds when a concurrent first submission already started the match', async () => {
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(matchWithStatus('scheduled'))
      .mockResolvedValueOnce(matchWithStatus('in_progress'));
    vi.mocked(updateMatchStatus).mockResolvedValueOnce(null as never);

    const result = await recordGameResult(baseInput);

    expect(createGame).toHaveBeenCalledTimes(1);
    expect(result.match_status).toBe('in_progress');
  });

  it('rejects with a 409 and writes no game when the match moved on before it could start', async () => {
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(matchWithStatus('scheduled'))
      .mockResolvedValueOnce(matchWithStatus('pending_confirmation'));
    vi.mocked(updateMatchStatus).mockResolvedValueOnce(null as never);

    const err = await recordGameResult(baseInput).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MatchStateConflictError);
    expect(err).toMatchObject({ code: 'match_result_conflict', statusCode: 409 });
    expect(createGame).not.toHaveBeenCalled();
  });

  it('surfaces a lost game-number race as the 409 from createGame, before stats or aggregates', async () => {
    const actual = await vi.importActual<typeof import('@/lib/supabase/queries/games')>(
      '@/lib/supabase/queries/games'
    );
    vi.mocked(createGame).mockRejectedValueOnce(new actual.GameNumberConflictError());

    const err = await recordGameResult(baseInput).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'GameNumberConflictError', code: 'match_result_conflict', statusCode: 409 });
    expect(createBattleStats).not.toHaveBeenCalled();
    expect(enqueueAggregateJob).not.toHaveBeenCalled();
    expect(transitionMatchStatus).not.toHaveBeenCalled();
  });

  it('reports the authoritative state when a concurrent writer moved the match to pending first', async () => {
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 1 });
    vi.mocked(transitionMatchStatus).mockResolvedValueOnce(null);
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(matchWithStatus('in_progress'))
      .mockResolvedValueOnce(matchWithStatus('pending_confirmation'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await recordGameResult(baseInput);

    expect(transitionMatchStatus).toHaveBeenCalledTimes(1);
    expect(result.match_status).toBe('pending_confirmation');
    expect(result.match_winner_id).toBe('player-2');
    // The lost race is logged like the one in reevaluateMatchStatus.
    expect(errorSpy).toHaveBeenCalledWith(
      '[game-pipeline] match match-1 moved from in_progress to pending_confirmation while game game-1 was ' +
        'recorded; the game is saved, the pending_confirmation write was not applied'
    );
    errorSpy.mockRestore();
  });

  it('rejects when the single status+timer write fails, and attempts no second write', async () => {
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 2 });
    const err = new Error('update failed');
    vi.mocked(transitionMatchStatus).mockRejectedValueOnce(err);

    await expect(recordGameResult(baseInput)).rejects.toBe(err);

    expect(transitionMatchStatus).toHaveBeenCalledTimes(1);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('throws on an invalid pending transition instead of silently skipping it', async () => {
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 1 });
    vi.mocked(validateTransition).mockReturnValueOnce({
      valid: false,
      error: 'Invalid transition: in_progress to pending_confirmation',
      code: 'match_transition_invalid',
    });

    await expect(recordGameResult(baseInput)).rejects.toThrow('Invalid transition');

    expect(transitionMatchStatus).not.toHaveBeenCalled();
  });
});

describe('deleteGame / editGame: round read and status re-evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGamesByMatch).mockResolvedValue([]);
  });

  it('deleteGame: a failed round read aborts before anything is deleted', async () => {
    vi.mocked(getRoundById).mockRejectedValueOnce(new Error('rounds read failed'));

    await expect(deleteGame('game-1', 'admin-1')).rejects.toThrow('rounds read failed');

    expect(cancelAggregateJobsForGame).not.toHaveBeenCalled();
    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(deleteUncountedGameRow).not.toHaveBeenCalled();
    expect(transitionMatchStatus).not.toHaveBeenCalled();
  });

  it('editGame: a failed round read aborts before anything is changed', async () => {
    vi.mocked(getRoundById).mockRejectedValueOnce(new Error('rounds read failed'));

    await expect(editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' }))
      .rejects.toThrow('rounds read failed');

    expect(cancelAggregateJobsForGame).not.toHaveBeenCalled();
    expect(rollbackGameAggregates).not.toHaveBeenCalled();
  });

  it('deleteGame: a failed revert read throws instead of silently skipping the round revert', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    vi.mocked(getRoundById)
      .mockResolvedValueOnce(round())
      .mockRejectedValueOnce(new Error('revert read failed'));

    await expect(deleteGame('game-1', 'admin-1')).rejects.toThrow('revert read failed');
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('deleteGame: reopens a completed round', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    vi.mocked(getRoundById)
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce(round({ status: 'completed' }));

    await deleteGame('game-1', 'admin-1');

    expect(updateRoundStatus).toHaveBeenCalledWith('round-1', 'pending');
  });

  it('deleteGame: back to in_progress clears any auto-confirm timer in the same write, CAS on the read status', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('pending_confirmation'));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });

    const result = await deleteGame('game-1', 'admin-1');

    expect(hasReachedBoThreshold).toHaveBeenCalledWith(3, 1, 0);
    expect(transitionMatchStatus).toHaveBeenCalledWith('match-1', {
      expectedStatus: 'pending_confirmation',
      status: 'in_progress',
      winnerId: null,
      submitterId: 'admin-1',
      autoConfirmAt: null,
    });
    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(result.match_status).toBe('in_progress');
  });

  it('deleteGame: uses the round best_of, never a Bo1 fallback', async () => {
    vi.mocked(getRoundById).mockResolvedValueOnce(round({ best_of: 5 }));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 2, player_2_wins: 0, player_ids: ['p1', 'p2'] });

    await deleteGame('game-1', 'admin-1');

    expect(hasReachedBoThreshold).toHaveBeenCalledWith(5, 2, 0);
  });

  it('editGame: entering pending_confirmation from in_progress starts without a timer (admin review)', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 2, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 1 });

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(transitionMatchStatus).toHaveBeenCalledWith('match-1', {
      expectedStatus: 'in_progress',
      status: 'pending_confirmation',
      winnerId: 'player-1',
      submitterId: 'admin-1',
      autoConfirmAt: null,
    });
    expect(result.match_status).toBe('pending_confirmation');
  });

  it('editGame: staying in pending_confirmation keeps the stored timer', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('pending_confirmation'));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 2, player_ids: ['p1', 'p2'] });
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 2 });

    await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    const [, transition] = vi.mocked(transitionMatchStatus).mock.calls[0];
    expect(transition).toEqual({
      expectedStatus: 'pending_confirmation',
      status: 'pending_confirmation',
      winnerId: 'player-2',
      submitterId: 'admin-1',
      autoConfirmAt: undefined,
    });
  });

  it('editGame: a concurrent status change keeps that status and reports the conflict after finishing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(matchWithStatus('in_progress'))
      .mockResolvedValueOnce({ ...matchWithStatus('completed'), winner_id: 'player-1' } as never);
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    vi.mocked(transitionMatchStatus).mockResolvedValueOnce(null);

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    // No second write over the concurrent writer's status.
    expect(transitionMatchStatus).toHaveBeenCalledTimes(1);
    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      match_status: 'completed',
      match_winner_id: 'player-1',
      match_status_conflict: true,
    }));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('moved from in_progress to completed'));
    consoleError.mockRestore();
  });

  it('deleteGame: a concurrent status change still finishes the round revert and reports the conflict', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(matchWithStatus('pending_confirmation'))
      .mockResolvedValueOnce({ ...matchWithStatus('completed'), winner_id: 'player-2' } as never);
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    vi.mocked(transitionMatchStatus).mockResolvedValueOnce(null);
    vi.mocked(getRoundById)
      .mockResolvedValueOnce(round())
      .mockResolvedValueOnce(round({ status: 'completed' }));

    const result = await deleteGame('game-1', 'admin-1');

    expect(result.match_status).toBe('completed');
    expect(result.match_status_conflict).toBe(true);
    expect(updateRoundStatus).toHaveBeenCalledWith('round-1', 'pending');
    consoleError.mockRestore();
  });

  it('deleteGame / editGame: no conflict flag when the status write lands', async () => {
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });

    const result = await deleteGame('game-1', 'admin-1');

    expect(result).not.toHaveProperty('match_status_conflict');
  });
});

describe('deleteGame / editGame on a COMPLETED match: ratings, streaks and signatures follow the match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGamesByMatch).mockResolvedValue([]);
  });

  it('deleteGame: a 2-0 Bo3 with one game deleted goes back to in_progress and both players are rebuilt', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('completed'));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });

    const result = await deleteGame('game-1', 'admin-1');

    expect(result.match_status).toBe('in_progress');
    // Preflight before the game is touched, excluding the match it un-completes.
    expect(planRatingRebuild).toHaveBeenCalledWith(['player-1', 'player-2'], { excludeMatchIds: ['match-1'] });
    expect(vi.mocked(planRatingRebuild).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(rollbackGameAggregates).mock.invocationCallOrder[0]);
    // Rebuild after the status moved, so the replay no longer counts the match.
    expect(rebuildRatingsForPlayers).toHaveBeenCalledWith(['player-1', 'player-2']);
    expect(vi.mocked(transitionMatchStatus).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(rebuildRatingsForPlayers).mock.invocationCallOrder[0]);
    expect(recomputeStreaks).toHaveBeenCalledWith('player-1');
    expect(recomputeStreaks).toHaveBeenCalledWith('player-2');
    expect(updateSignatures).toHaveBeenCalledWith('player-1');
    expect(updateSignatures).toHaveBeenCalledWith('player-2');
    expect(result.recalculation?.ratingsRebuilt).toEqual({ players: ['player-1', 'player-2'] });
  });

  it('deleteGame: a refused rating preflight aborts with nothing deleted', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('completed'));
    vi.mocked(planRatingRebuild).mockRejectedValueOnce(new Error('history gap cycle'));

    await expect(deleteGame('game-1', 'admin-1')).rejects.toThrow('history gap cycle');

    expect(rollbackGameAggregates).not.toHaveBeenCalled();
    expect(transitionMatchStatus).not.toHaveBeenCalled();
    expect(rebuildRatingsForPlayers).not.toHaveBeenCalled();
  });

  it('deleteGame: a match that was not completed rebuilds nothing', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('pending_confirmation'));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 1, player_2_wins: 0, player_ids: ['p1', 'p2'] });

    const result = await deleteGame('game-1', 'admin-1');

    expect(planRatingRebuild).not.toHaveBeenCalled();
    expect(rebuildRatingsForPlayers).not.toHaveBeenCalled();
    expect(recomputeStreaks).not.toHaveBeenCalled();
    expect(result.recalculation).not.toHaveProperty('ratingsRebuilt');
  });

  it('editGame: an edit that moves a completed match to pending_confirmation rebuilds both players', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(matchWithStatus('completed'));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 0, player_2_wins: 2, player_ids: ['p1', 'p2'] });
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 2 });

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1', winner_id: 'player-2' });

    expect(result.match_status).toBe('pending_confirmation');
    expect(planRatingRebuild).toHaveBeenCalledWith(['player-1', 'player-2'], { excludeMatchIds: ['match-1'] });
    expect(rebuildRatingsForPlayers).toHaveBeenCalledWith(['player-1', 'player-2']);
    expect(recomputeStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(result.ratings_rebuilt).toEqual(['player-1', 'player-2']);
  });

  it('editGame: a concurrent writer that kept the match completed means no rebuild', async () => {
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(matchWithStatus('completed'))
      .mockResolvedValueOnce(matchWithStatus('completed'));
    vi.mocked(getGameWinCounts).mockResolvedValueOnce({ player_1_wins: 2, player_2_wins: 0, player_ids: ['p1', 'p2'] });
    vi.mocked(hasReachedBoThreshold).mockReturnValueOnce({ reached: true, winner_id_index: 1 });
    vi.mocked(transitionMatchStatus).mockResolvedValueOnce(null);

    const result = await editGame({ game_id: 'game-1', admin_id: 'admin-1' });

    expect(result.match_status_conflict).toBe(true);
    expect(rebuildRatingsForPlayers).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('ratings_rebuilt');
  });
});
