import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/tournament/bracket-propagation', () => ({
  propagateBracketOnMatchComplete: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/discord/helpers', () => ({
  buildGamePokemonStats: vi.fn(() => []),
  computePokemonScoreFromGameStats: vi.fn(() => ({ p1: 2, p2: 1 })),
}));

vi.mock('@/lib/gamification/achievements', () => ({
  checkAchievements: vi.fn(),
}));

vi.mock('@/lib/gamification/signatures', () => ({
  updateSignatures: vi.fn(),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  updateStreaks: vi.fn(),
  recomputeStreaks: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  markMatchFinalized: vi.fn(),
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getRatingHistoryByMatch: vi.fn(),
  getRatingHistoryByMatches: vi.fn(),
  // No test league unless a test says otherwise (clearAllMocks keeps this default).
  loadRatingScope: vi.fn(async () => ({ testSeasonTournamentIds: new Set<string>() })),
}));

vi.mock('@/lib/supabase/queries/match-snapshots', () => ({
  getMatchSnapshots: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-outcomes', () => ({
  recordMatchOutcome: vi.fn(async () => 'written'),
  getMatchOutcome: vi.fn(async () => null),
  deleteMatchOutcome: vi.fn(async () => 1),
}));

vi.mock('@/lib/format-engine/runtime/hooks', () => ({
  onMatchCompleted: vi.fn(async () => true),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  updateRatings: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/match/epb-matchday', () => ({
  runEpbMatchdayHooks: vi.fn(),
}));

vi.mock('@/lib/match/evolution-match-evaluator', () => ({
  creditMatchRealKills: vi.fn(),
}));

import { createRatingScope } from '@/lib/rating/rating-scope';
import { StagedOutcomeBlockedError } from '../staged-outcome';
import {
  FINALIZE_HEAL_POLICY,
  FINALIZE_STEPS,
  discardStagedAdminOutcome,
  finalizeMatchCompletion,
  findMatchesNeedingAdmin,
  healMatchFinalization,
  stageAdminOutcome,
} from '../finalize';
import { emitSocialEvent } from '@/lib/social/notify';
import { getMatchById, markMatchFinalized } from '@/lib/supabase/queries/matches';
import { getRatingHistoryByMatch, getRatingHistoryByMatches, loadRatingScope } from '@/lib/supabase/queries/ratings';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { revalidateMatchPages } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { propagateBracketOnMatchComplete } from '@/lib/tournament/bracket-propagation';
import { logAuditEvent } from '@/lib/audit/log';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { runEpbMatchdayHooks } from '@/lib/match/epb-matchday';
import { creditMatchRealKills } from '@/lib/match/evolution-match-evaluator';
import { checkAchievements } from '@/lib/gamification/achievements';
import { updateSignatures } from '@/lib/gamification/signatures';
import { recomputeStreaks, updateStreaks } from '@/lib/gamification/streaks';
import { updateRatings } from '@/lib/rating/updateRatings';
import { deleteMatchOutcome, getMatchOutcome, recordMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { onMatchCompleted } from '@/lib/format-engine/runtime/hooks';
import type { MatchWithPlayers } from '@/types/match';
import type { StreakChanges } from '@/types/streak';

const match: MatchWithPlayers = {
  id: 'match-1',
  round_id: 'round-1',
  tournament_id: 'tournament-1',
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  winner_id: 'player-1',
  status: 'pending_confirmation',
  submitter_id: 'player-1',
  date_played: null,
  scheduled_at: null,
  auto_confirm_at: null,
  confirmed_at: null,
  bracket_side: null,
  bracket_pos: null,
  notes: '',
  social_image_url: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  winner_name: 'Alice',
  round_status: 'active',
  games: [{ id: 'game-1', game_number: 1, winner_id: 'player-1', replay_url: 'https://replay.test', source: 'ps_replay', stats_locked: false }],
};

const STREAK_CHANGES: StreakChanges = {
  win_streak: { before: 0, after: 1 },
  loss_streak: { before: 0, after: 0 },
  ko_streak: { before: 0, after: 0 },
  flawless_streak: { before: 0, after: 0 },
  new_records: [],
};

let errorSpy: ReturnType<typeof vi.spyOn>;

describe('finalizeMatchCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'Weekly',
      season_id: 'season-1',
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({});
    vi.mocked(onMatchCompleted).mockResolvedValue(true);
    vi.mocked(getMatchOutcome).mockResolvedValue(null);
    vi.mocked(updateRatings).mockResolvedValue({
      status: 'rated',
      winnerRating: 1520,
      loserRating: 1480,
      winnerChange: 20,
      loserChange: -20,
    });
    vi.mocked(recomputeStreaks).mockResolvedValue(STREAK_CHANGES);
    vi.mocked(updateSignatures).mockResolvedValue([]);
    vi.mocked(checkAchievements).mockResolvedValue([]);
    vi.mocked(markMatchFinalized).mockResolvedValue(true);
    // The completion the run owns: a completed row whose `confirmed_at` is the token the marker is bound to.
    vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', confirmed_at: null });
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(propagateBracketOnMatchComplete).mockResolvedValue();
    vi.mocked(runEpbMatchdayHooks).mockResolvedValue();
    vi.mocked(creditMatchRealKills).mockResolvedValue({
      applied: ['game-1'], alreadyApplied: [], notCompleted: [], missing: [], events: [],
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('runs shared completion side effects once for newly completed matches', async () => {
    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result).toEqual({ finalized: true, complete: true, failed_steps: [] });
    expect(revalidateMatchPages).toHaveBeenCalledWith('tournament-1', 'match-1');
    expect(updateRatings).toHaveBeenCalledWith('player-1', 'player-2', false, 'match-1');
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(emitDiscordEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'match_confirmed' }));
    expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: null });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  describe('the outcome step', () => {
    const stat = (player_id: string, was_koed: boolean) => ({ player_id, was_koed }) as never;

    it('records a played outcome with the faint tally of every game, from a replay', async () => {
      vi.mocked(getBattleStatsByMatch).mockResolvedValue({
        'game-1': [stat('player-1', true), stat('player-1', false), stat('player-2', true), stat('player-2', true)],
        'game-2': [stat('player-2', true)],
      });

      await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(recordMatchOutcome).toHaveBeenCalledWith({
        matchId: 'match-1',
        kind: 'played',
        p1Faints: 1,
        p2Faints: 3,
        source: 'replay',
        reason: null,
        setBy: null,
        force: true,
      });
    });

    it('records unknown faints (null, not zero) for a match without battle stats, from a manual result', async () => {
      await finalizeMatchCompletion({
        match: { ...match, games: [{ ...match.games[0], source: 'manual' }] },
        winnerId: 'player-1',
        previousStatus: 'pending_confirmation',
      });

      expect(recordMatchOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'played', p1Faints: null, p2Faints: null, source: 'manual', force: true })
      );
    });

    it.each(['forfeit', 'no_show'] as const)('writes an admin %s with force and no faints, even without battle stats', async (kind) => {
      vi.mocked(getBattleStatsByMatch).mockRejectedValue(new Error('stats read failed'));

      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', winner_id: 'player-2', confirmed_at: null });
      const result = await finalizeMatchCompletion({
        match,
        winnerId: 'player-2',
        previousStatus: 'scheduled',
        adminOutcome: { kind, reason: 'Alice did not show up', setBy: 'admin-1' },
      });

      expect(recordMatchOutcome).toHaveBeenCalledWith({
        matchId: 'match-1',
        kind,
        p1Faints: null,
        p2Faints: null,
        source: 'admin',
        reason: 'Alice did not show up',
        setBy: 'admin-1',
        force: true,
      });
      expect(result.failed_steps).not.toContain('outcome');
    });

    it('gives an admin played result the faint tally of the recorded games', async () => {
      vi.mocked(getBattleStatsByMatch).mockResolvedValue({ 'game-1': [stat('player-1', true), stat('player-2', false)] });

      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', winner_id: 'player-2', confirmed_at: null });
      await finalizeMatchCompletion({
        match,
        winnerId: 'player-2',
        previousStatus: 'in_progress',
        adminOutcome: { kind: 'played', reason: 'Agreed in Discord', setBy: 'admin-1' },
      });

      expect(recordMatchOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'played', p1Faints: 1, p2Faints: 0, source: 'admin', force: true })
      );
    });

    it('still rewrites the row with its own admin played outcome when the battle-stats read failed (a concurrent staging may have replaced it)', async () => {
      vi.mocked(getBattleStatsByMatch).mockRejectedValue(new Error('stats read failed'));

      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', winner_id: 'player-2', confirmed_at: null });
      const result = await finalizeMatchCompletion({
        match,
        winnerId: 'player-2',
        previousStatus: 'scheduled',
        adminOutcome: { kind: 'played', reason: 'Agreed in Discord', setBy: 'admin-1' },
      });

      expect(recordMatchOutcome).toHaveBeenCalledWith({
        matchId: 'match-1',
        kind: 'played',
        p1Faints: null,
        p2Faints: null,
        source: 'admin',
        reason: 'Agreed in Discord',
        setBy: 'admin-1',
        force: true,
      });
      // Only the stats read failed: the faints are unknown, so the heal fills them and the marker stays unset.
      expect(result.failed_steps).toContain('battle_stats');
      expect(result.failed_steps).not.toContain('outcome');
      expect(result.complete).toBe(false);
    });

    it('replaces a leftover staged admin row when the completion carries no admin intent (the staging request died before its flip)', async () => {
      // A staged admin row from a request that never completed the match is still in the table; the players confirm.
      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      // The played row is written with force: the RPC lets a forced write replace an admin row, a plain one never does.
      expect(recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'played', source: 'replay', force: true }));
      expect(result.failed_steps).not.toContain('outcome');
    });

    it('never forces the played row on the admin path: the admin outcome is the only forced write there', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', winner_id: 'player-2', confirmed_at: null });
      await finalizeMatchCompletion({
        match,
        winnerId: 'player-2',
        previousStatus: 'scheduled',
        adminOutcome: { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' },
      });

      expect(recordMatchOutcome).toHaveBeenCalledTimes(1);
      expect(recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'forfeit', source: 'admin', force: true }));
    });

    it('fails the outcome step on a write error and keeps the match off the finalized marker', async () => {
      vi.mocked(recordMatchOutcome).mockRejectedValueOnce(new Error('rpc failed'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result.failed_steps).toEqual(['outcome']);
      expect(result.complete).toBe(false);
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });
  });

  it('sends the achievement key with gold/platinum unlocks so embeds can localize the name', async () => {
    vi.mocked(checkAchievements)
      .mockResolvedValueOnce([
        { key: 'win_streak_10', name: 'Unstoppable', tier: 'gold', icon: 'flame', description: 'Win 10 in a row' },
      ] as never)
      .mockResolvedValueOnce([]);

    await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(emitDiscordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'achievement_unlocked',
        data: expect.objectContaining({
          kind: 'achievement_unlocked',
          player_name: 'Alice',
          achievement_key: 'win_streak_10',
          achievement_name: 'Unstoppable',
          achievement_tier: 'gold',
        }),
      }),
    );
  });

  describe('win streak milestone', () => {
    const winnerStreak = (before: number, after: number): StreakChanges => ({
      ...STREAK_CHANGES,
      win_streak: { before, after },
    });
    const milestone = expect.objectContaining({ event_type: 'streak_milestone' });

    it('announces a milestone when the win streak rises onto a multiple of five', async () => {
      vi.mocked(recomputeStreaks).mockResolvedValueOnce(winnerStreak(4, 5)).mockResolvedValueOnce(STREAK_CHANGES);

      await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(emitDiscordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'streak_milestone',
          data: expect.objectContaining({ streak_count: 5, player_name: 'Alice' }),
        }),
      );
    });

    it('announces nothing when the rebuilt streak sits on a milestone it already held', async () => {
      vi.mocked(recomputeStreaks).mockResolvedValueOnce(winnerStreak(5, 5)).mockResolvedValueOnce(STREAK_CHANGES);

      await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(emitDiscordEvent).not.toHaveBeenCalledWith(milestone);
    });
  });

  it('skips idempotently when the previous state was already completed', async () => {
    const result = await finalizeMatchCompletion({
      match: { ...match, status: 'completed' },
      winnerId: 'player-1',
      previousStatus: 'completed',
    });

    expect(result).toEqual({ finalized: false, reason: 'already_completed' });
    expect(updateRatings).not.toHaveBeenCalled();
    expect(revalidateMatchPages).not.toHaveBeenCalled();
  });

  it('does not run EPB matchday hooks or credit real kills for non-EPB seasons', async () => {
    await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
    expect(creditMatchRealKills).not.toHaveBeenCalled();
  });

  it('credits the real kills of every game at completion, before the matchday hooks', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 3 } as never);
    const stat = { id: 's1', game_id: 'game-2', player_id: 'player-1', pokemon_name: 'Charmander', kos_dealt: 2 };
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({ 'game-2': [stat] } as never);
    const order: string[] = [];
    vi.mocked(creditMatchRealKills).mockImplementation(async () => {
      order.push('kills');
      return { applied: ['game-1', 'game-2'], alreadyApplied: [], notCompleted: [], missing: [], events: [] };
    });
    vi.mocked(runEpbMatchdayHooks).mockImplementation(async () => {
      order.push('hooks');
    });

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result).toEqual({ finalized: true, complete: true, failed_steps: [] });
    expect(creditMatchRealKills).toHaveBeenCalledTimes(1);
    expect(creditMatchRealKills).toHaveBeenCalledWith({
      seasonId: 'season-1',
      matchday: 3,
      playerIds: ['player-1', 'player-2'],
      // the match's game without stats too, and every game with stats
      gameIds: ['game-1', 'game-2'],
      statsByGame: { 'game-2': [stat] },
    });
    expect(order).toEqual(['kills', 'hooks']);
    expect(runEpbMatchdayHooks).toHaveBeenCalledWith(expect.objectContaining({ matchday: 3, battleStats: [stat] }));
  });

  it('credits nothing again on a repeated finalize call for an already completed match', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);

    const result = await finalizeMatchCompletion({
      match: { ...match, status: 'completed' },
      winnerId: 'player-1',
      previousStatus: 'completed',
    });

    expect(result).toEqual({ finalized: false, reason: 'already_completed' });
    expect(creditMatchRealKills).not.toHaveBeenCalled();
  });

  it('blocks the matchday hooks when the real-kill credit fails, and heals both', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 3 } as never);
    const err = new Error('credit rpc failed');
    vi.mocked(creditMatchRealKills).mockRejectedValue(err);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.failed_steps).toEqual(['epb_real_kills', 'epb_hooks']);
    expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
    expect(markMatchFinalized).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[match-finalize] step "epb_real_kills" failed for match match-1', err);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'match.finalize_failed',
        metadata: expect.objectContaining({
          failed_steps: ['epb_real_kills', 'epb_hooks'],
          healed_automatically: ['epb_real_kills', 'epb_hooks'],
        }),
      })
    );
  });

  it('runs EPB matchday hooks once for evolution_point_buy seasons', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 3 } as never);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.finalized).toBe(true);
    expect(runEpbMatchdayHooks).toHaveBeenCalledWith({
      match,
      seasonId: 'season-1',
      matchday: 3,
      battleStats: [],
    });
  });

  it('never blocks match completion when EPB bookkeeping fails', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 2 } as never);
    const err = new Error('DB down');
    vi.mocked(runEpbMatchdayHooks).mockRejectedValue(err);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.finalized).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.failed_steps).toEqual(['epb_hooks']);
    // Ratings and the rest still ran; only the marker is withheld.
    expect(updateRatings).toHaveBeenCalled();
    expect(checkAchievements).toHaveBeenCalledTimes(2);
    expect(markMatchFinalized).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[match-finalize] step "epb_hooks" failed for match match-1', err);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'match.finalize_failed',
        resource_id: 'match-1',
        metadata: expect.objectContaining({
          failed_steps: ['epb_hooks'],
          healed_automatically: ['epb_hooks'],
          verified_by_heal: [],
          needs_admin: [],
        }),
      })
    );
  });

  it('overlays the winner onto the match before propagating', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'Weekly',
      season_id: 'season-1',
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(propagateBracketOnMatchComplete).mockResolvedValue();

    await finalizeMatchCompletion({
      match: { ...match, winner_id: null, status: 'in_progress' },
      winnerId: 'player-1',
      previousStatus: 'in_progress',
    });

    expect(propagateBracketOnMatchComplete).toHaveBeenCalledWith(
      expect.objectContaining({ winner_id: 'player-1', status: 'completed' }),
      expect.anything(),
      expect.anything()
    );
  });

  it('records a propagation failure without blocking finalize', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'Weekly',
      season_id: 'season-1',
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(propagateBracketOnMatchComplete).mockRejectedValue(new Error('boom'));

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.finalized).toBe(true);
    expect(result.propagation_failed).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'match.propagation_failed', resource_id: 'match-1' })
    );
  });

  it('does not stamp finalized_at after a bracket propagation failure', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'Weekly',
      season_id: 'season-1',
      bracket_type: 'double_elim',
    } as never);
    vi.mocked(propagateBracketOnMatchComplete).mockRejectedValue(new Error('boom'));

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.failed_steps).toEqual(['bracket_propagation']);
    expect(markMatchFinalized).not.toHaveBeenCalled();
  });

  it('keeps running EPB hooks, streaks and achievements when ratings fail, and flags ratings for an admin', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 4 } as never);
    const err = new Error('Incomplete rating history for match match-1');
    vi.mocked(updateRatings).mockRejectedValue(err);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result).toEqual({ finalized: true, complete: false, failed_steps: ['ratings'] });
    expect(recomputeStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).toHaveBeenCalledTimes(2);
    expect(runEpbMatchdayHooks).toHaveBeenCalledWith(expect.objectContaining({ matchday: 4 }));
    // The result post still goes out; only the rating milestone needs the rating step.
    expect(emitDiscordEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'match_confirmed' }));
    expect(emitDiscordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'rating_milestone' }));
    expect(markMatchFinalized).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[match-finalize] step "ratings" failed for match match-1', err);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'match.finalize_failed',
        metadata: expect.objectContaining({
          failed_steps: ['ratings'],
          healed_automatically: [],
          // Ratings are verify-only: the heal finishes the match by itself
          // when the rows exist; it is not an admin item up front.
          verified_by_heal: ['ratings'],
          needs_admin: [],
        }),
      })
    );
  });

  it('announces no rating milestone for a test-league match (its ratings were not applied)', async () => {
    vi.mocked(updateRatings).mockResolvedValue({ status: 'skipped_test_season' });

    const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

    expect(result).toEqual({ finalized: true, complete: true, failed_steps: [] });
    expect(emitDiscordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'rating_milestone' }));
    expect(emitDiscordEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'match_confirmed' }));
    expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: null });
  });

  it('emits the rating milestone when the rating step crosses a threshold', async () => {
    vi.mocked(updateRatings).mockResolvedValue({
      status: 'rated',
      winnerRating: 1610,
      loserRating: 1480,
      winnerChange: 20,
      loserChange: -20,
    });

    await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

    expect(emitDiscordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'rating_milestone', data: expect.objectContaining({ threshold: 'rising_star' }) })
    );
    expect(emitSocialEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'rating_milestone' }));
  });

  it('blocks the steps that need the match battle stats when that read fails, and runs the others (streaks read their own history)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getBattleStatsByMatch).mockRejectedValue(new Error('stats read failed'));

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.failed_steps).toEqual(['battle_stats', 'outcome', 'announcements', 'epb_real_kills', 'epb_hooks']);
    expect(recordMatchOutcome).not.toHaveBeenCalled();
    expect(updateRatings).toHaveBeenCalled();
    expect(recomputeStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).toHaveBeenCalledTimes(2);
    expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
    expect(creditMatchRealKills).not.toHaveBeenCalled();
    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[match-finalize] step "announcements" not run for match match-1: "battle_stats" failed'
    );
  });

  it('treats a missing tournament as a failure and still applies ratings, streaks and signatures', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.failed_steps).toEqual([
      'tournament',
      'achievements',
      'announcements',
      'epb_real_kills',
      'epb_hooks',
      'bracket_propagation',
    ]);
    expect(updateRatings).toHaveBeenCalled();
    expect(recomputeStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).not.toHaveBeenCalled();
    expect(markMatchFinalized).not.toHaveBeenCalled();
  });

  it('rebuilds both players streaks from their history and records a failed rebuild without stopping the rest', async () => {
    const err = new Error('streaks replace refused twice');
    vi.mocked(recomputeStreaks).mockRejectedValueOnce(err);

    const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

    expect(recomputeStreaks).toHaveBeenCalledWith('player-1');
    expect(recomputeStreaks).toHaveBeenCalledWith('player-2');
    expect(result.failed_steps).toEqual(['streaks']);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith('[match-finalize] step "streaks" failed for match match-1', err);
    expect(markMatchFinalized).not.toHaveBeenCalled();
  });

  it('records a failed cache revalidation instead of aborting finalize', async () => {
    vi.mocked(revalidateMatchPages).mockImplementationOnce(() => {
      throw new Error('revalidateTag outside a request');
    });

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.failed_steps).toEqual(['revalidate']);
    expect(updateRatings).toHaveBeenCalled();
    expect(markMatchFinalized).not.toHaveBeenCalled();
  });

  it('fails the EPB step (instead of skipping it silently) when the round is missing', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tournament-1',
      name: 'EvoLiga',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    } as never);
    vi.mocked(getRoundById).mockResolvedValue(null);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.failed_steps).toEqual(['epb_real_kills', 'epb_hooks']);
    expect(creditMatchRealKills).not.toHaveBeenCalled();
    expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
  });

  it('records a failed marker write as its own step', async () => {
    vi.mocked(markMatchFinalized).mockRejectedValue(new Error('update failed'));

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result).toEqual({ finalized: true, complete: false, failed_steps: ['mark_finalized'] });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'match.finalize_failed',
        metadata: expect.objectContaining({ failed_steps: ['mark_finalized'] }),
      })
    );
  });

  it('is not complete when the match was reset before the marker could be written', async () => {
    vi.mocked(markMatchFinalized).mockResolvedValue(false);

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result).toEqual({ finalized: true, complete: false, failed_steps: [] });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a winner who is not a participant before any side effect', async () => {
    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-3',
      previousStatus: 'pending_confirmation',
    });

    expect(result).toEqual({ finalized: false, reason: 'winner_not_participant' });
    expect(updateRatings).not.toHaveBeenCalled();
    expect(markMatchFinalized).not.toHaveBeenCalled();
  });

  describe('the completion a run owns', () => {
    const COMPLETION_A = '2026-11-08T10:00:00.000Z';

    it('binds the marker to the confirmed_at of the completion it started from', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', confirmed_at: COMPLETION_A });

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result).toEqual({ finalized: true, complete: true, failed_steps: [] });
      expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: COMPLETION_A });
    });

    it('does not stamp when the match was reopened and completed again meanwhile (the stamp misses its token)', async () => {
      // The database answers false for a row whose confirmed_at is no longer the one the run read.
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', confirmed_at: COMPLETION_A });
      vi.mocked(markMatchFinalized).mockResolvedValue(false);

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result.complete).toBe(false);
      expect(result.failed_steps).toEqual([]);
    });

    it.each(['in_progress', 'scheduled', 'pending_confirmation'] as const)(
      'runs nothing when the match is %s by the time it starts (a reset or reopen got there first)',
      async (status) => {
        vi.mocked(getMatchById).mockResolvedValue({ ...match, status });

        const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

        expect(result).toEqual({ finalized: false, reason: 'match_changed', current_status: status });
        expect(updateRatings).not.toHaveBeenCalled();
        expect(recordMatchOutcome).not.toHaveBeenCalled();
        expect(onMatchCompleted).not.toHaveBeenCalled();
        expect(markMatchFinalized).not.toHaveBeenCalled();
      }
    );

    it('runs nothing when the match was completed again with another winner (a different completion, its own run)', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed', winner_id: 'player-2', confirmed_at: COMPLETION_A });

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result).toEqual({ finalized: false, reason: 'match_changed', current_status: 'completed' });
      expect(updateRatings).not.toHaveBeenCalled();
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('still runs its steps when the completion read fails, and leaves the marker unset for the heal', async () => {
      vi.mocked(getMatchById).mockRejectedValue(new Error('read failed'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(updateRatings).toHaveBeenCalled();
      expect(result).toEqual({ finalized: true, complete: false, failed_steps: ['mark_finalized'] });
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('writes the outcome row before anything slower: a completed match is visible to the standings from the flip on', async () => {
      await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      const outcomeAt = vi.mocked(recordMatchOutcome).mock.invocationCallOrder[0];
      expect(outcomeAt).toBeLessThan(vi.mocked(updateRatings).mock.invocationCallOrder[0]);
      expect(outcomeAt).toBeLessThan(vi.mocked(recomputeStreaks).mock.invocationCallOrder[0]);
    });

    it('expires the caches after the last write step and before the marker, not before the first write', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'Cup',
        season_id: null,
        bracket_type: 'single_elim',
      } as never);

      await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      const revalidateAt = vi.mocked(revalidateMatchPages).mock.invocationCallOrder[0];
      for (const written of [
        vi.mocked(updateRatings),
        vi.mocked(recordMatchOutcome),
        vi.mocked(recomputeStreaks),
        vi.mocked(propagateBracketOnMatchComplete),
      ]) {
        expect(written.mock.invocationCallOrder[0]).toBeLessThan(revalidateAt);
      }
      expect(revalidateAt).toBeLessThan(vi.mocked(markMatchFinalized).mock.invocationCallOrder[0]);
      expect(revalidateMatchPages).toHaveBeenCalledTimes(1);
    });

    it('expires the caches even when a step failed (the writes that did land are visible), leaving the marker unset', async () => {
      vi.mocked(recomputeStreaks).mockRejectedValue(new Error('streaks failed'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result.failed_steps).toEqual(['streaks']);
      expect(revalidateMatchPages).toHaveBeenCalledWith('tournament-1', 'match-1');
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });
  });

  describe('the format runtime step', () => {
    const customLeague = { id: 'tournament-1', name: 'Weekly', season_id: 'season-1', season_format_type: 'custom' };

    beforeEach(() => {
      vi.mocked(getTournamentById).mockResolvedValue(customLeague as never);
    });

    it('fires match_completed after the outcome is recorded, as a finalize step', async () => {
      const order: string[] = [];
      vi.mocked(recordMatchOutcome).mockImplementation(async () => {
        order.push('outcome');
        return 'written';
      });
      vi.mocked(onMatchCompleted).mockImplementation(async () => {
        order.push('hook');
        return true;
      });

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(order).toEqual(['outcome', 'hook']);
      expect(onMatchCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 'match-1', roundId: 'round-1', player1Id: 'player-1', player2Id: 'player-2', winnerId: 'player-1' })
      );
      expect(result).toEqual({ finalized: true, complete: true, failed_steps: [] });
    });

    it('does not fire the hook after a failed bracket propagation: the stage end must not complete the phase around the missing next-slot match', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({ ...customLeague, bracket_type: 'single_elim' } as never);
      vi.mocked(getParticipants).mockResolvedValue([]);
      vi.mocked(propagateBracketOnMatchComplete).mockRejectedValue(new Error('boom'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(onMatchCompleted).not.toHaveBeenCalled();
      expect(result.propagation_failed).toBe(true);
      // The propagation failed and the hook is blocked behind it (reported like any blocked step); the marker stays unset.
      expect(result.failed_steps).toEqual(['bracket_propagation', 'format_hook']);
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('does not run for a league that is not a custom league', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({ ...customLeague, season_format_type: 'swiss' } as never);

      await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(onMatchCompleted).not.toHaveBeenCalled();
    });

    it('fails the step when the hook did not apply: no marker, and the heal retries it', async () => {
      vi.mocked(onMatchCompleted).mockResolvedValue(false);

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result).toEqual({ finalized: true, complete: false, failed_steps: ['format_hook'] });
      expect(markMatchFinalized).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'match.finalize_failed',
          metadata: expect.objectContaining({ failed_steps: ['format_hook'], healed_automatically: ['format_hook'] }),
        })
      );
    });

    it('fails the step when the hook throws', async () => {
      vi.mocked(onMatchCompleted).mockRejectedValue(new Error('import failed'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(result.failed_steps).toEqual(['format_hook']);
      expect(errorSpy).toHaveBeenCalledWith('[match-finalize] step "format_hook" failed for match match-1', expect.any(Error));
    });

    it('never runs when the outcome step failed: the event would fire with no faints and burn its key', async () => {
      vi.mocked(recordMatchOutcome).mockRejectedValueOnce(new Error('rpc failed'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(onMatchCompleted).not.toHaveBeenCalled();
      expect(result.failed_steps).toEqual(['outcome', 'format_hook']);
    });

    it('never runs when the outcome step is blocked by missing battle stats', async () => {
      vi.mocked(getBattleStatsByMatch).mockRejectedValue(new Error('stats read failed'));

      const result = await finalizeMatchCompletion({ match, winnerId: 'player-1', previousStatus: 'pending_confirmation' });

      expect(onMatchCompleted).not.toHaveBeenCalled();
      expect(result.failed_steps).toContain('format_hook');
    });
  });

  describe('staging the admin outcome', () => {
    it('writes the admin row with force and no faints, before any completion, never over a completed match', async () => {
      await stageAdminOutcome('match-1', { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' });

      expect(recordMatchOutcome).toHaveBeenCalledWith({
        matchId: 'match-1',
        kind: 'forfeit',
        p1Faints: null,
        p2Faints: null,
        source: 'admin',
        reason: 'No show',
        setBy: 'admin-1',
        force: true,
        openOnly: true,
      });
    });

    it('lets a failed write reach the caller (nothing is completed then)', async () => {
      vi.mocked(recordMatchOutcome).mockRejectedValueOnce(new Error('rpc failed'));

      await expect(stageAdminOutcome('match-1', { kind: 'no_show', reason: 'No show', setBy: null })).rejects.toThrow('rpc failed');
    });

    it('answers the set_at of the row it wrote, to identify its own row later', async () => {
      vi.mocked(getMatchOutcome).mockResolvedValueOnce(null).mockResolvedValueOnce({
        match_id: 'match-1', kind: 'forfeit', p1_faints: null, p2_faints: null, source: 'admin', reason: 'No show',
        set_by: 'admin-1', set_at: '2026-11-06T10:00:00.123456+00:00',
      });

      await expect(stageAdminOutcome('match-1', { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' })).resolves.toEqual({
        setAt: '2026-11-06T10:00:00.123456+00:00',
      });
    });

    it('answers no handle when nothing was written (the match was completed already)', async () => {
      vi.mocked(recordMatchOutcome).mockResolvedValueOnce('kept');

      await expect(stageAdminOutcome('match-1', { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' })).resolves.toBeNull();
      // only the look before the write; nothing was written, so nothing is read back
      expect(getMatchOutcome).toHaveBeenCalledTimes(1);
    });

    it('answers no handle, without failing, when the row cannot be read back', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(getMatchOutcome).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('read failed'));

      await expect(stageAdminOutcome('match-1', { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' })).resolves.toBeNull();
    });

    const unresolvedRow = {
      match_id: 'match-1', kind: 'unresolved' as const, p1_faints: null, p2_faints: null, source: 'replay' as const,
      reason: 'replay_engine_tie', set_by: null, set_at: '2026-11-06T09:00:00+00:00',
    };

    it('refuses to stage over the unresolved row of a match a replay-tie disputed, and writes nothing', async () => {
      vi.mocked(getMatchOutcome).mockResolvedValueOnce(unresolvedRow);
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'disputed' });

      await expect(stageAdminOutcome('match-1', { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' })).rejects.toBeInstanceOf(
        StagedOutcomeBlockedError
      );
      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });

    it('stages over a stale unresolved row of a match that is not disputed (it is not a dispute\'s row any more)', async () => {
      vi.mocked(getMatchOutcome).mockResolvedValueOnce(unresolvedRow).mockResolvedValueOnce(null);
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'in_progress' });

      await stageAdminOutcome('match-1', { kind: 'forfeit', reason: 'No show', setBy: 'admin-1' });

      expect(recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ source: 'admin', force: true, openOnly: true }));
    });

    it('puts the unresolved row back when the match was disputed meanwhile (the dispute row lost to the staged one)', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'disputed' });

      await discardStagedAdminOutcome('match-1', { setAt: 'at-1' });

      expect(deleteMatchOutcome).toHaveBeenCalledWith('match-1', { onlyIfSetAt: 'at-1' });
      expect(recordMatchOutcome).toHaveBeenCalledTimes(1);
      expect(recordMatchOutcome).toHaveBeenCalledWith({
        matchId: 'match-1',
        kind: 'unresolved',
        p1Faints: null,
        p2Faints: null,
        source: 'replay',
        reason: 'replay_engine_tie',
        setBy: null,
        force: false,
      });
    });

    it('does not restore anything for a match that is not disputed, or when the row was not its own any more', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'in_progress' });
      await discardStagedAdminOutcome('match-1', { setAt: 'at-1' });
      expect(recordMatchOutcome).not.toHaveBeenCalled();

      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'disputed' });
      vi.mocked(deleteMatchOutcome).mockResolvedValueOnce(0);
      await discardStagedAdminOutcome('match-1', { setAt: 'at-1' });
      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });

    it('puts the unresolved row back for a disputed match even without a handle (the read-back of the staged row failed)', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'disputed' });

      await discardStagedAdminOutcome('match-1');

      expect(deleteMatchOutcome).toHaveBeenCalledWith('match-1', {});
      expect(recordMatchOutcome).toHaveBeenCalledTimes(1);
      expect(recordMatchOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 'match-1', kind: 'unresolved', source: 'replay', force: false })
      );
    });

    it('does not write a played row without a handle (the row that went may be another writer\'s)', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed' });

      await discardStagedAdminOutcome('match-1');

      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });

    it('does not look at the match when no row was deleted without a handle', async () => {
      vi.mocked(deleteMatchOutcome).mockResolvedValueOnce(0);

      await discardStagedAdminOutcome('match-1');

      expect(getMatchById).not.toHaveBeenCalled();
      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });

    it('removes the row again when the completion did not happen', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'in_progress' });

      await discardStagedAdminOutcome('match-1');

      expect(deleteMatchOutcome).toHaveBeenCalledWith('match-1', {});
      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });

    it('removes only the row it wrote, and leaves the match alone while it is open', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'scheduled' });

      await discardStagedAdminOutcome('match-1', { setAt: 'at-1' });

      expect(deleteMatchOutcome).toHaveBeenCalledWith('match-1', { onlyIfSetAt: 'at-1' });
      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });

    it('writes the played row in its place when a request without admin intent completed the match meanwhile', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed' });
      vi.mocked(getBattleStatsByMatch).mockResolvedValue({});

      await discardStagedAdminOutcome('match-1', { setAt: 'at-1' });

      expect(deleteMatchOutcome).toHaveBeenCalledWith('match-1', { onlyIfSetAt: 'at-1' });
      expect(recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'match-1', kind: 'played', force: false }));
    });

    it('leaves everything as it is when the row is no longer the one it wrote (another request rewrote it)', async () => {
      vi.mocked(deleteMatchOutcome).mockResolvedValueOnce(0);

      await discardStagedAdminOutcome('match-1', { setAt: 'at-1' });

      expect(getMatchById).not.toHaveBeenCalled();
      expect(recordMatchOutcome).not.toHaveBeenCalled();
    });
  });

  it('declares a heal policy for every step, and never re-runs the non-idempotent ones', () => {
    expect(Object.keys(FINALIZE_HEAL_POLICY).sort()).toEqual([...FINALIZE_STEPS].sort());
    expect(FINALIZE_HEAL_POLICY.ratings).toBe('verify');
    expect(FINALIZE_HEAL_POLICY.achievements).toBe('not_rerun');
    expect(FINALIZE_HEAL_POLICY.announcements).toBe('not_rerun');
  });

  describe('healMatchFinalization', () => {
    const completed: MatchWithPlayers = { ...match, status: 'completed' };

    beforeEach(() => {
      vi.mocked(getRatingHistoryByMatch).mockResolvedValue([
        { player_id: 'player-1', match_id: 'match-1' },
        { player_id: 'player-2', match_id: 'match-1' },
      ] as never);
      vi.mocked(recomputeStreaks).mockResolvedValue(STREAK_CHANGES);
      vi.mocked(getMatchSnapshots).mockResolvedValue([]);
    });

    it('re-runs only the replay-safe steps, verifies ratings and stamps the marker', async () => {
      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: true, failed_steps: [] });
      expect(revalidateMatchPages).toHaveBeenCalledWith('tournament-1', 'match-1');
      expect(getRatingHistoryByMatch).toHaveBeenCalledWith('match-1');
      expect(recomputeStreaks).toHaveBeenCalledWith('player-1');
      expect(recomputeStreaks).toHaveBeenCalledWith('player-2');
      expect(updateSignatures).toHaveBeenCalledTimes(2);
      // Never re-applied: Glicko, incremental streaks, achievement counters, posts.
      expect(updateRatings).not.toHaveBeenCalled();
      expect(updateStreaks).not.toHaveBeenCalled();
      expect(checkAchievements).not.toHaveBeenCalled();
      expect(emitDiscordEvent).not.toHaveBeenCalled();
      expect(emitSocialEvent).not.toHaveBeenCalled();
      expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: null });
      // The played outcome is rewritten without force, so an admin row survives the heal.
      expect(recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'played', force: false }));
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'match.finalize_healed',
          resource_id: 'match-1',
          metadata: expect.objectContaining({ not_rerun: ['achievements', 'announcements'] }),
        })
      );
    });

    describe('the completion it heals', () => {
      const HEALED_AT = '2026-11-08T10:00:00.000Z';
      const snapshot: MatchWithPlayers = { ...completed, confirmed_at: HEALED_AT };

      it('stamps the marker bound to the confirmed_at of the worklist row', async () => {
        vi.mocked(getMatchById).mockResolvedValue({ ...snapshot });

        const result = await healMatchFinalization(snapshot);

        expect(result).toEqual({ healed: true, failed_steps: [] });
        expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: HEALED_AT });
      });

      it.each([
        ['reopened and completed again (another confirmed_at)', { confirmed_at: '2026-11-08T11:00:00.000Z' }],
        ['completed again with the other winner', { winner_id: 'player-2' }],
        ['reopened', { status: 'in_progress' as const }],
        ['reset', { status: 'scheduled' as const }],
      ])('heals nothing when the match was %s since the worklist read', async (_label, change) => {
        vi.mocked(getMatchById).mockResolvedValue({ ...snapshot, ...change });

        const result = await healMatchFinalization(snapshot);

        expect(result).toEqual({ healed: false, skipped: true, reason: 'not_completed', failed_steps: [] });
        expect(recomputeStreaks).not.toHaveBeenCalled();
        expect(recordMatchOutcome).not.toHaveBeenCalled();
        expect(propagateBracketOnMatchComplete).not.toHaveBeenCalled();
        expect(onMatchCompleted).not.toHaveBeenCalled();
        expect(markMatchFinalized).not.toHaveBeenCalled();
      });

      it('keeps the match on the worklist when the completion read fails', async () => {
        vi.mocked(getMatchById).mockRejectedValue(new Error('read failed'));

        const result = await healMatchFinalization(snapshot);

        expect(result).toEqual({ healed: false, failed_steps: ['mark_finalized'] });
        expect(recomputeStreaks).not.toHaveBeenCalled();
      });

      it('expires the caches after the last write, also when a step failed', async () => {
        vi.mocked(recomputeStreaks).mockRejectedValue(new Error('streaks failed'));

        const result = await healMatchFinalization(completed);

        expect(result).toEqual({ healed: false, failed_steps: ['streaks'] });
        expect(revalidateMatchPages).toHaveBeenCalledTimes(1);
        expect(vi.mocked(revalidateMatchPages).mock.invocationCallOrder[0]).toBeGreaterThan(
          vi.mocked(updateSignatures).mock.invocationCallOrder[0]
        );
      });
    });

    it('stops at a ratings verify with missing history: needs an admin, re-runs nothing else', async () => {
      vi.mocked(getRatingHistoryByMatch).mockResolvedValue([{ player_id: 'player-1', match_id: 'match-1' }] as never);
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'Cup',
        season_id: null,
        bracket_type: 'single_elim',
      } as never);

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({
        healed: false,
        needs_admin: true,
        reason: 'ratings_missing',
        failed_steps: ['ratings'],
      });
      expect(updateRatings).not.toHaveBeenCalled();
      expect(recomputeStreaks).not.toHaveBeenCalled();
      expect(updateSignatures).not.toHaveBeenCalled();
      expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
      expect(propagateBracketOnMatchComplete).not.toHaveBeenCalled();
      expect(getTournamentById).not.toHaveBeenCalled();
      expect(markMatchFinalized).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has 1 of 2 rows'));
    });

    it('stops when the rating history read fails: a plain failure, retried next run', async () => {
      const boom = new Error('read timeout');
      vi.mocked(getRatingHistoryByMatch).mockRejectedValue(boom);

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: false, failed_steps: ['ratings'] });
      expect(result.needs_admin).toBeUndefined();
      expect(recomputeStreaks).not.toHaveBeenCalled();
      expect(updateSignatures).not.toHaveBeenCalled();
      expect(markMatchFinalized).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('[match-heal] step "ratings" failed for match match-1', boom);
    });

    it('re-runs the real-kill credit on every heal (once per game by its marker) and the hooks only while there are no snapshots', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'EvoLiga',
        season_id: 'season-1',
        season_format_type: 'evolution_point_buy',
      } as never);
      vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 5 } as never);

      const result = await healMatchFinalization(completed);

      expect(result.healed).toBe(true);
      expect(creditMatchRealKills).toHaveBeenCalledWith(
        expect.objectContaining({ seasonId: 'season-1', matchday: 5, gameIds: ['game-1'] })
      );
      expect(runEpbMatchdayHooks).toHaveBeenCalledWith({
        match: completed,
        seasonId: 'season-1',
        matchday: 5,
        battleStats: [],
      });

      vi.mocked(runEpbMatchdayHooks).mockClear();
      vi.mocked(creditMatchRealKills).mockClear();
      vi.mocked(creditMatchRealKills).mockResolvedValue({
        applied: [], alreadyApplied: ['game-1'], notCompleted: [], missing: [], events: [],
      });
      vi.mocked(getMatchSnapshots).mockResolvedValue([{ match_id: 'match-1' }] as never);

      const second = await healMatchFinalization(completed);

      expect(second.healed).toBe(true);
      // Called again, but the game is already credited: the RPC writes nothing.
      expect(creditMatchRealKills).toHaveBeenCalledTimes(1);
      expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
    });

    it('stops before the hooks when the healed credit fails, and keeps the match on the worklist', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'EvoLiga',
        season_id: 'season-1',
        season_format_type: 'evolution_point_buy',
      } as never);
      vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 5 } as never);
      vi.mocked(creditMatchRealKills).mockRejectedValue(new Error('credit rpc failed'));

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: false, failed_steps: ['epb_real_kills', 'epb_hooks'] });
      expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('reports a failing EPB re-run and keeps the match on the worklist', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'EvoLiga',
        season_id: 'season-1',
        season_format_type: 'evolution_point_buy',
      } as never);
      vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 5 } as never);
      vi.mocked(runEpbMatchdayHooks).mockRejectedValue(new Error('tracker write failed'));

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: false, failed_steps: ['epb_hooks'] });
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('re-runs bracket propagation for elimination formats', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'Cup',
        season_id: null,
        bracket_type: 'single_elim',
      } as never);

      const result = await healMatchFinalization(completed);

      expect(result.healed).toBe(true);
      expect(propagateBracketOnMatchComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'match-1', winner_id: 'player-1', status: 'completed' }),
        expect.anything(),
        []
      );
    });

    it('verifies a test-league match without rating history (it stays out of ratings) and heals it', async () => {
      vi.mocked(loadRatingScope).mockResolvedValueOnce(createRatingScope(['tournament-1']));
      vi.mocked(getRatingHistoryByMatch).mockResolvedValue([]);

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: true, failed_steps: [] });
      expect(getRatingHistoryByMatch).not.toHaveBeenCalled();
      expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: null });
    });

    it('propagates a failed rating-scope read as a failed ratings verify (retried next run)', async () => {
      vi.mocked(loadRatingScope).mockRejectedValueOnce(new Error('seasons read failed'));

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: false, failed_steps: ['ratings'] });
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    describe('the format runtime step', () => {
      beforeEach(() => {
        vi.mocked(getTournamentById).mockResolvedValue({
          id: 'tournament-1',
          name: 'Weekly',
          season_id: 'season-1',
          season_format_type: 'custom',
        } as never);
      });

      it('calls the hook again for a match whose first call failed, then stamps the marker', async () => {
        const result = await healMatchFinalization(completed);

        expect(result).toEqual({ healed: true, failed_steps: [] });
        expect(onMatchCompleted).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'match-1', winnerId: 'player-1' }));
        expect(markMatchFinalized).toHaveBeenCalledWith('match-1', undefined, { confirmedAt: null });
      });

      it('keeps the match on the worklist while the hook keeps failing', async () => {
        vi.mocked(onMatchCompleted).mockResolvedValue(false);

        const result = await healMatchFinalization(completed);

        expect(result).toEqual({ healed: false, failed_steps: ['format_hook'] });
        expect(markMatchFinalized).not.toHaveBeenCalled();
      });

      it('does not call the hook when the outcome could not be restored', async () => {
        vi.mocked(recordMatchOutcome).mockRejectedValueOnce(new Error('rpc failed'));

        const result = await healMatchFinalization(completed);

        expect(onMatchCompleted).not.toHaveBeenCalled();
        expect(result.failed_steps).toEqual(['outcome', 'format_hook']);
      });

      it('does not call the hook after a failed bracket propagation: the stage end must not complete the phase around the missing slot', async () => {
        vi.mocked(getTournamentById).mockResolvedValue({
          id: 'tournament-1',
          name: 'Cup',
          season_id: 'season-1',
          season_format_type: 'custom',
          bracket_type: 'single_elim',
        } as never);
        vi.mocked(propagateBracketOnMatchComplete).mockRejectedValue(new Error('boom'));

        const result = await healMatchFinalization(completed);

        expect(onMatchCompleted).not.toHaveBeenCalled();
        expect(result).toEqual({ healed: false, failed_steps: ['bracket_propagation', 'format_hook'] });
        expect(markMatchFinalized).not.toHaveBeenCalled();
      });

      it('runs the propagation before the hook', async () => {
        vi.mocked(getTournamentById).mockResolvedValue({
          id: 'tournament-1',
          name: 'Cup',
          season_id: 'season-1',
          season_format_type: 'custom',
          bracket_type: 'single_elim',
        } as never);

        await healMatchFinalization(completed);

        expect(vi.mocked(propagateBracketOnMatchComplete).mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(onMatchCompleted).mock.invocationCallOrder[0]
        );
      });
    });

    describe('the outcome step', () => {
      const stat = (player_id: string, was_koed: boolean) => ({ player_id, was_koed }) as never;
      const adminRow = (kind: string) =>
        ({ match_id: 'match-1', kind, source: 'admin', reason: 'No show', set_by: 'admin-1', p1_faints: null, p2_faints: null }) as never;

      it('leaves an admin forfeit as it is: the heal never turns it into a played row', async () => {
        vi.mocked(getMatchOutcome).mockResolvedValue(adminRow('forfeit'));

        const result = await healMatchFinalization(completed);

        expect(result.healed).toBe(true);
        expect(recordMatchOutcome).not.toHaveBeenCalled();
      });

      it('rewrites an admin played result from itself with the faints of the recorded games', async () => {
        vi.mocked(getMatchOutcome).mockResolvedValue(adminRow('played'));
        vi.mocked(getBattleStatsByMatch).mockResolvedValue({ 'game-1': [stat('player-1', true), stat('player-2', true), stat('player-2', true)] });

        await healMatchFinalization(completed);

        expect(recordMatchOutcome).toHaveBeenCalledWith({
          matchId: 'match-1',
          kind: 'played',
          p1Faints: 1,
          p2Faints: 2,
          source: 'admin',
          reason: 'No show',
          setBy: 'admin-1',
          force: true,
        });
      });

      it('writes the played row for a match without an admin row', async () => {
        vi.mocked(getMatchOutcome).mockResolvedValue(null);

        await healMatchFinalization(completed);

        expect(recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'played', source: 'replay', force: false }));
      });
    });

    it('refuses a match that is not completed', async () => {
      const result = await healMatchFinalization({ ...match, status: 'pending_confirmation' });

      expect(result).toEqual({ healed: false, skipped: true, reason: 'not_completed', failed_steps: [] });
      expect(recomputeStreaks).not.toHaveBeenCalled();
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('reports a completed match without a participant winner as needing an admin', async () => {
      const result = await healMatchFinalization({ ...completed, winner_id: 'player-9' });

      expect(result).toEqual({
        healed: false,
        needs_admin: true,
        reason: 'winner_not_participant',
        failed_steps: [],
      });
      expect(getRatingHistoryByMatch).not.toHaveBeenCalled();
      expect(recomputeStreaks).not.toHaveBeenCalled();
      expect(markMatchFinalized).not.toHaveBeenCalled();
    });

    it('is not healed when the match was reset before the marker write', async () => {
      vi.mocked(markMatchFinalized).mockResolvedValue(false);

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: false, skipped: true, reason: 'not_completed', failed_steps: [] });
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});

describe('findMatchesNeedingAdmin', () => {
  const completed = { ...match, status: 'completed' as const };
  const row = (matchId: string, playerId: string) => ({ match_id: matchId, player_id: playerId }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies the whole page with one batched history read', async () => {
    const rated = { ...completed, id: 'rated' };
    const oneSided = { ...completed, id: 'one-sided' };
    const unrated = { ...completed, id: 'unrated' };
    const noWinner = { ...completed, id: 'no-winner', winner_id: null };
    const foreignWinner = { ...completed, id: 'foreign-winner', winner_id: 'player-9' };
    vi.mocked(getRatingHistoryByMatches).mockResolvedValueOnce([
      row('rated', 'player-1'),
      row('rated', 'player-2'),
      row('one-sided', 'player-1'),
    ]);

    const result = await findMatchesNeedingAdmin([rated, oneSided, unrated, noWinner, foreignWinner]);

    expect(getRatingHistoryByMatches).toHaveBeenCalledTimes(1);
    // Winner-less rows need no history read.
    expect(getRatingHistoryByMatches).toHaveBeenCalledWith(['rated', 'one-sided', 'unrated']);
    expect([...result.entries()]).toEqual([
      ['no-winner', 'winner_not_participant'],
      ['foreign-winner', 'winner_not_participant'],
      ['one-sided', 'ratings_missing'],
      ['unrated', 'ratings_missing'],
    ]);
  });

  it('never lists a test-league match as ratings_missing and reads no history for it', async () => {
    vi.mocked(loadRatingScope).mockResolvedValueOnce(createRatingScope(['t-test']));
    const testLeague = { ...completed, id: 'test-league', tournament_id: 't-test' };
    const unrated = { ...completed, id: 'unrated' };
    vi.mocked(getRatingHistoryByMatches).mockResolvedValueOnce([]);

    const result = await findMatchesNeedingAdmin([testLeague, unrated]);

    expect(getRatingHistoryByMatches).toHaveBeenCalledWith(['unrated']);
    expect([...result.entries()]).toEqual([['unrated', 'ratings_missing']]);
  });

  it('skips the history read when every winner-bearing row is a test-league match', async () => {
    vi.mocked(loadRatingScope).mockResolvedValueOnce(createRatingScope(['tournament-1']));

    const result = await findMatchesNeedingAdmin([completed]);

    expect(getRatingHistoryByMatches).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('skips the history read when no row has a participant winner', async () => {
    const result = await findMatchesNeedingAdmin([{ ...completed, winner_id: null }]);

    expect(getRatingHistoryByMatches).not.toHaveBeenCalled();
    expect(result.get('match-1')).toBe('winner_not_participant');
  });

  it('returns an empty map for an empty page without reading', async () => {
    expect((await findMatchesNeedingAdmin([])).size).toBe(0);
    expect(getRatingHistoryByMatches).not.toHaveBeenCalled();
  });

  it('propagates a failed history read (the cron run fails instead of guessing)', async () => {
    const err = new Error('history read failed');
    vi.mocked(getRatingHistoryByMatches).mockRejectedValueOnce(err);

    await expect(findMatchesNeedingAdmin([completed])).rejects.toBe(err);
  });
});
