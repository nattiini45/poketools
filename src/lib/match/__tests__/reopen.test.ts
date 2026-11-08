import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  transitionMatchStatus: vi.fn(),
  clearMatchSocialImage: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-analyses', () => ({ deleteMatchAnalysis: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({ deleteMatchPrepAnalysesByMatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-snapshots', () => ({ deleteMatchSnapshots: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({
  deleteMatchOutcome: vi.fn(async () => 0),
  getMatchOutcome: vi.fn(async () => null),
}));

vi.mock('@/lib/tournament/bracket-propagation', () => ({
  unpropagateBracketOnMatchReset: vi.fn(),
}));

// Every function that changes a game, so a reopen that starts to delete or edit one is caught.
vi.mock('@/lib/supabase/queries/games', () => ({
  createGame: vi.fn(),
  updateGameWinner: vi.fn(),
  setGameStatsLocked: vi.fn(),
  deleteUncountedGameRow: vi.fn(),
  deleteBattleStatsByGame: vi.fn(),
  createBattleStats: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  deleteGame: vi.fn(),
  editGame: vi.fn(),
  resetMatch: vi.fn(),
  collectPlayedDownstreamMatches: vi.fn(),
  preflightUncompleteRebuild: vi.fn(),
  rebuildGamificationAfterUncomplete: vi.fn(),
  recheckEvolutions: vi.fn(),
  revertRoundIfCompleted: vi.fn(),
}));

vi.mock('@/lib/reconcile/evolution-rebuild', () => ({
  repairSeasonEvolution: vi.fn(),
}));

vi.mock('@/lib/format-engine/runtime/hooks', () => ({ revertMatchCompletion: vi.fn() }));

import { MatchReopenDownstreamPlayedError, MatchStateChangedError, reopenMatch } from '../reopen';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  clearMatchSocialImage,
  getMatchById,
  transitionMatchStatus,
} from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { deleteMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { deleteMatchPrepAnalysesByMatch } from '@/lib/supabase/queries/match-prep-analyses';
import { deleteMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { deleteMatchOutcome, getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { unpropagateBracketOnMatchReset } from '@/lib/tournament/bracket-propagation';
import {
  collectPlayedDownstreamMatches,
  preflightUncompleteRebuild,
  rebuildGamificationAfterUncomplete,
  recheckEvolutions,
  revertRoundIfCompleted,
} from '@/lib/pkmn/game-pipeline';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import { revertMatchCompletion } from '@/lib/format-engine/runtime/hooks';
import * as gameQueries from '@/lib/supabase/queries/games';
import { deleteGame, editGame, resetMatch } from '@/lib/pkmn/game-pipeline';

const MATCH_ID = 'match-1';
const OUTCOME_SET_AT = '2026-11-01T10:00:00.000Z';
const games = [
  { id: 'g1', game_number: 1, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
  { id: 'g2', game_number: 2, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
];

function makeMatch(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    round_id: 'round-1',
    tournament_id: 'tourn-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    winner_id: 'p1',
    status,
    submitter_id: 'p2',
    games,
    ...overrides,
  };
}

const tournament = {
  id: 'tourn-1',
  season_id: 'season-1',
  season_format_type: 'round_robin',
  bracket_type: 'single_elim',
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});

  vi.mocked(getMatchById).mockResolvedValue(makeMatch('completed') as never);
  // The outcome row the reopen takes back: read before the flip, deleted by its set_at.
  vi.mocked(getMatchOutcome).mockResolvedValue({ set_at: OUTCOME_SET_AT } as never);
  vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
  vi.mocked(getParticipants).mockResolvedValue([] as never);
  vi.mocked(collectPlayedDownstreamMatches).mockResolvedValue([]);
  vi.mocked(preflightUncompleteRebuild).mockImplementation(async () => {
    calls.push('preflight');
  });
  vi.mocked(transitionMatchStatus).mockImplementation(async () => {
    calls.push('write');
    return { id: MATCH_ID, status: 'in_progress' } as never;
  });
  vi.mocked(revertRoundIfCompleted).mockResolvedValue(undefined);
  vi.mocked(unpropagateBracketOnMatchReset).mockResolvedValue([]);
  vi.mocked(rebuildGamificationAfterUncomplete).mockResolvedValue(['p1', 'p2']);
  vi.mocked(recheckEvolutions).mockResolvedValue({ events: [], failed: false });
  vi.mocked(repairSeasonEvolution).mockResolvedValue({} as never);
  vi.mocked(revertMatchCompletion).mockResolvedValue(true);
  // A test that made a step fail must not leak into the next ones.
  vi.mocked(deleteMatchSnapshots).mockResolvedValue(undefined);
});

describe('reopenMatch of a completed match', () => {
  it('runs the preflight before the write, then every post-commit step', async () => {
    vi.mocked(unpropagateBracketOnMatchReset).mockResolvedValue(['later-1', 'later-2']);

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(calls).toEqual(['preflight', 'write']);
    expect(result).toEqual({
      from_status: 'completed',
      ratings_rebuilt_players: 2,
      bracket_matches_removed: 2,
      failed_steps: [],
    });
    expect(revertRoundIfCompleted).toHaveBeenCalledWith('round-1');
    expect(deleteMatchOutcome).toHaveBeenCalledWith(MATCH_ID, { onlyIfSetAt: OUTCOME_SET_AT });
    expect(unpropagateBracketOnMatchReset).toHaveBeenCalledTimes(1);
    expect(deleteMatchAnalysis).toHaveBeenCalledWith(MATCH_ID);
    expect(deleteMatchPrepAnalysesByMatch).toHaveBeenCalledWith(MATCH_ID);
    expect(deleteMatchSnapshots).toHaveBeenCalledWith(MATCH_ID);
    expect(clearMatchSocialImage).toHaveBeenCalledWith(MATCH_ID);
    expect(rebuildGamificationAfterUncomplete).toHaveBeenCalledWith(true, 'in_progress', 'p1', 'p2');
  });

  it('writes one compare-and-set payload that clears the result and keeps submitter and games', async () => {
    await reopenMatch(MATCH_ID, 'admin-1');

    expect(transitionMatchStatus).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(transitionMatchStatus).mock.calls[0];
    expect(payload[0]).toBe(MATCH_ID);
    expect(payload[1]).toEqual({
      expectedStatus: 'completed',
      status: 'in_progress',
      winnerId: null,
      autoConfirmAt: null,
      confirmedAt: null,
      datePlayed: null,
    });
    expect(payload[1]).not.toHaveProperty('submitterId');
  });

  it('never touches the games', async () => {
    const before = structuredClone(games);
    for (const status of ['completed', 'pending_confirmation', 'disputed']) {
      vi.mocked(getMatchById).mockResolvedValue(makeMatch(status) as never);
      await reopenMatch(MATCH_ID, 'admin-1');
    }

    expect(deleteGame).not.toHaveBeenCalled();
    expect(editGame).not.toHaveBeenCalled();
    expect(resetMatch).not.toHaveBeenCalled();
    for (const [name, fn] of Object.entries(gameQueries)) {
      expect(fn, name).not.toHaveBeenCalled();
    }
    expect(games).toEqual(before);
  });

  it('calls repairSeasonEvolution for an Evolution Point Buy season and not the legacy recheck', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...tournament,
      season_format_type: 'evolution_point_buy',
    } as never);

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(repairSeasonEvolution).toHaveBeenCalledWith('season-1');
    expect(recheckEvolutions).not.toHaveBeenCalled();
    expect(result.failed_steps).toEqual([]);
  });

  it('calls recheckEvolutions for other seasons and not the season repair', async () => {
    await reopenMatch(MATCH_ID, 'admin-1');

    expect(recheckEvolutions).toHaveBeenCalledWith('season-1', 'p1', 'p2');
    expect(repairSeasonEvolution).not.toHaveBeenCalled();
  });

  it('refuses with MatchReopenDownstreamPlayedError and writes nothing when later matches were played', async () => {
    vi.mocked(collectPlayedDownstreamMatches).mockResolvedValue([{ id: 'later' }, { id: 'later-2' }] as never);

    const error = await reopenMatch(MATCH_ID, 'admin-1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MatchReopenDownstreamPlayedError);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('match_reopen_downstream_played');
    expect((error as UserFacingError).statusCode).toBe(409);
    expect((error as UserFacingError).params).toEqual({ count: 2 });
    expect(transitionMatchStatus).not.toHaveBeenCalled();
    expect(revertRoundIfCompleted).not.toHaveBeenCalled();
  });

  it('writes nothing when the rating rebuild plan is refused', async () => {
    vi.mocked(preflightUncompleteRebuild).mockRejectedValue(new Error('history gap cycle'));

    await expect(reopenMatch(MATCH_ID, 'admin-1')).rejects.toThrow('history gap cycle');

    expect(transitionMatchStatus).not.toHaveBeenCalled();
    expect(collectPlayedDownstreamMatches).not.toHaveBeenCalled();
  });

  it('throws MatchStateChangedError on a compare-and-set miss and runs no post-commit step', async () => {
    vi.mocked(transitionMatchStatus).mockResolvedValue(null);

    const error = await reopenMatch(MATCH_ID, 'admin-1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MatchStateChangedError);
    expect((error as UserFacingError).code).toBe('match_state_changed');
    expect((error as UserFacingError).statusCode).toBe(409);
    expect(revertRoundIfCompleted).not.toHaveBeenCalled();
    expect(rebuildGamificationAfterUncomplete).not.toHaveBeenCalled();
  });

  it('names the status the match has now when the compare-and-set misses', async () => {
    vi.mocked(transitionMatchStatus).mockResolvedValue(null);
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(makeMatch('completed') as never)
      .mockResolvedValueOnce(makeMatch('disputed') as never);

    const error = await reopenMatch(MATCH_ID, 'admin-1').catch((err: unknown) => err);

    expect((error as UserFacingError).code).toBe('match_state_changed');
    expect((error as UserFacingError).params).toEqual({ status: 'disputed' });
  });

  it('reports a failing step and still runs the others', async () => {
    vi.mocked(unpropagateBracketOnMatchReset).mockRejectedValue(new Error('bracket down'));
    vi.mocked(rebuildGamificationAfterUncomplete).mockRejectedValue(new Error('ratings down'));

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(result.failed_steps).toEqual(['bracket', 'ratings']);
    expect(result.ratings_rebuilt_players).toBe(0);
    expect(result.bracket_matches_removed).toBe(0);
    expect(revertRoundIfCompleted).toHaveBeenCalledTimes(1);
    expect(clearMatchSocialImage).toHaveBeenCalledTimes(1);
    expect(recheckEvolutions).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('reports cleanup, round and evolution failures by name', async () => {
    vi.mocked(revertRoundIfCompleted).mockRejectedValue(new Error('round down'));
    vi.mocked(deleteMatchSnapshots).mockRejectedValue(new Error('snapshots down'));
    vi.mocked(recheckEvolutions).mockResolvedValue({ events: [], failed: true });

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(result.failed_steps).toEqual(['round', 'cleanup', 'evolution']);
  });
});

describe('reopenMatch and the format runtime', () => {
  const customTournament = { ...tournament, season_format_type: 'custom' };

  it('takes back the completion of a custom league after the outcome step', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(customTournament as never);
    const order: string[] = [];
    vi.mocked(deleteMatchOutcome).mockImplementation(async () => {
      order.push('outcome');
      return 0;
    });
    vi.mocked(revertMatchCompletion).mockImplementation(async () => {
      order.push('format');
      return true;
    });
    vi.mocked(revertRoundIfCompleted).mockImplementation(async () => {
      order.push('round');
    });

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(revertMatchCompletion).toHaveBeenCalledWith({ tournamentId: 'tourn-1', matchId: MATCH_ID });
    expect(order).toEqual(['outcome', 'format', 'round']);
    expect(result.failed_steps).toEqual([]);
  });

  it('does not touch the format runtime for a league that cannot run a kit format', async () => {
    await reopenMatch(MATCH_ID, 'admin-1');
    expect(revertMatchCompletion).not.toHaveBeenCalled();
  });

  it('does not revert a pending_confirmation match, which never completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(customTournament as never);
    vi.mocked(getMatchById).mockResolvedValue(makeMatch('pending_confirmation') as never);
    await reopenMatch(MATCH_ID, 'admin-1');
    expect(revertMatchCompletion).not.toHaveBeenCalled();
  });

  it('ends the dispute of a disputed match in the format runtime (its unresolved check), and nothing else', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(customTournament as never);
    vi.mocked(getMatchById).mockResolvedValue(makeMatch('disputed') as never);
    vi.mocked(revertMatchCompletion).mockResolvedValue(true);

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(revertMatchCompletion).toHaveBeenCalledWith({ tournamentId: 'tourn-1', matchId: MATCH_ID });
    expect(revertRoundIfCompleted).not.toHaveBeenCalled();
    expect(result.failed_steps).toEqual([]);
  });

  it('reports a failed dispute close of a disputed match as the format step', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(customTournament as never);
    vi.mocked(getMatchById).mockResolvedValue(makeMatch('disputed') as never);
    vi.mocked(revertMatchCompletion).mockResolvedValue(false);
    const result = await reopenMatch(MATCH_ID, 'admin-1');
    expect(result.failed_steps).toEqual(['format']);
  });

  it('does not touch the format runtime for a disputed match of a league that runs no kit format', async () => {
    vi.mocked(getMatchById).mockResolvedValue(makeMatch('disputed') as never);
    await reopenMatch(MATCH_ID, 'admin-1');
    expect(revertMatchCompletion).not.toHaveBeenCalled();
  });

  it('reports a failed revert as the format step and still runs the others', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(customTournament as never);
    vi.mocked(revertMatchCompletion).mockResolvedValue(false);

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(result.failed_steps).toEqual(['format']);
    expect(revertRoundIfCompleted).toHaveBeenCalledTimes(1);
    expect(rebuildGamificationAfterUncomplete).toHaveBeenCalledTimes(1);
  });

  it('reports a revert that throws as the format step', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(customTournament as never);
    vi.mocked(revertMatchCompletion).mockRejectedValue(new Error('import failed'));

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(result.failed_steps).toEqual(['format']);
  });
});

describe('reopenMatch of a match that never finalized', () => {
  it.each(['pending_confirmation', 'disputed'])('only writes the status and drops the outcome row for %s', async (status) => {
    vi.mocked(getMatchById).mockResolvedValue(makeMatch(status) as never);

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(result).toEqual({
      from_status: status,
      ratings_rebuilt_players: 0,
      bracket_matches_removed: 0,
      failed_steps: [],
    });
    expect(vi.mocked(transitionMatchStatus).mock.calls[0][1]).toMatchObject({
      expectedStatus: status,
      status: 'in_progress',
      winnerId: null,
    });
    expect(preflightUncompleteRebuild).not.toHaveBeenCalled();
    expect(collectPlayedDownstreamMatches).not.toHaveBeenCalled();
    expect(revertRoundIfCompleted).not.toHaveBeenCalled();
    expect(unpropagateBracketOnMatchReset).not.toHaveBeenCalled();
    expect(rebuildGamificationAfterUncomplete).not.toHaveBeenCalled();
    expect(repairSeasonEvolution).not.toHaveBeenCalled();
    expect(recheckEvolutions).not.toHaveBeenCalled();
    expect(deleteMatchAnalysis).not.toHaveBeenCalled();
    // The unresolved row of a disputed replay tie goes with the dispute.
    expect(deleteMatchOutcome).toHaveBeenCalledWith(MATCH_ID, { onlyIfSetAt: OUTCOME_SET_AT });
  });

  it('deletes only the outcome row that existed before the flip, never one staged after it', async () => {
    // The row is read before the status write; a settle that stages a new row afterwards carries another set_at, so the
    // set_at-guarded delete leaves it alone.
    const order: string[] = [];
    vi.mocked(getMatchOutcome).mockImplementation(async () => {
      order.push('read');
      return { set_at: OUTCOME_SET_AT } as never;
    });
    vi.mocked(transitionMatchStatus).mockImplementation(async () => {
      order.push('write');
      return { id: MATCH_ID, status: 'in_progress' } as never;
    });
    vi.mocked(deleteMatchOutcome).mockImplementation(async () => {
      order.push('delete');
      return 0;
    });

    await reopenMatch(MATCH_ID, 'admin-1');

    expect(order).toEqual(['read', 'write', 'delete']);
  });

  it('deletes nothing when the match had no outcome row to take back', async () => {
    vi.mocked(getMatchOutcome).mockResolvedValue(null);

    await reopenMatch(MATCH_ID, 'admin-1');

    expect(deleteMatchOutcome).not.toHaveBeenCalled();
  });

  it('a compare-and-set miss still throws MatchStateChangedError and keeps the outcome row', async () => {
    vi.mocked(getMatchById).mockResolvedValue(makeMatch('disputed') as never);
    vi.mocked(transitionMatchStatus).mockResolvedValue(null);

    await expect(reopenMatch(MATCH_ID, 'admin-1')).rejects.toBeInstanceOf(MatchStateChangedError);
    expect(deleteMatchOutcome).not.toHaveBeenCalled();
  });

  it('reports a failed outcome delete as its own step', async () => {
    vi.mocked(getMatchById).mockResolvedValue(makeMatch('disputed') as never);
    vi.mocked(deleteMatchOutcome).mockRejectedValueOnce(new Error('outcome delete failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reopenMatch(MATCH_ID, 'admin-1');

    expect(result.failed_steps).toEqual(['outcome']);
  });
});

describe('reopenMatch refusals', () => {
  it.each(['scheduled', 'in_progress'])('answers match_transition_invalid for %s', async (status) => {
    vi.mocked(getMatchById).mockResolvedValue(makeMatch(status) as never);

    const error = await reopenMatch(MATCH_ID, 'admin-1').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('match_transition_invalid');
    expect((error as UserFacingError).statusCode).toBe(400);
    expect((error as UserFacingError).params).toEqual({ from: status, to: 'in_progress' });
    expect(transitionMatchStatus).not.toHaveBeenCalled();
  });

  it('throws when the match or the tournament is gone', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);
    await expect(reopenMatch(MATCH_ID, 'admin-1')).rejects.toThrow('Match not found');

    vi.mocked(getMatchById).mockResolvedValue(makeMatch('completed') as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);
    await expect(reopenMatch(MATCH_ID, 'admin-1')).rejects.toThrow('Tournament not found');
  });
});
