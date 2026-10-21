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

vi.mock('@/lib/rating/updateRatings', () => ({
  updateRatings: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/match/epb-matchday', () => ({
  runEpbMatchdayHooks: vi.fn(),
}));

import { createRatingScope } from '@/lib/rating/rating-scope';
import {
  FINALIZE_HEAL_POLICY,
  FINALIZE_STEPS,
  finalizeMatchCompletion,
  findMatchesNeedingAdmin,
  healMatchFinalization,
} from '../finalize';
import { emitSocialEvent } from '@/lib/social/notify';
import { markMatchFinalized } from '@/lib/supabase/queries/matches';
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
import { checkAchievements } from '@/lib/gamification/achievements';
import { updateSignatures } from '@/lib/gamification/signatures';
import { recomputeStreaks, updateStreaks } from '@/lib/gamification/streaks';
import { updateRatings } from '@/lib/rating/updateRatings';
import type { MatchWithPlayers } from '@/types/match';

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
    vi.mocked(updateRatings).mockResolvedValue({
      status: 'rated',
      winnerRating: 1520,
      loserRating: 1480,
      winnerChange: 20,
      loserChange: -20,
    });
    vi.mocked(updateStreaks).mockResolvedValue({
      win_streak: { before: 0, after: 1 },
      loss_streak: { before: 0, after: 0 },
      ko_streak: { before: 0, after: 0 },
      flawless_streak: { before: 0, after: 0 },
      new_records: [],
    });
    vi.mocked(updateSignatures).mockResolvedValue([]);
    vi.mocked(checkAchievements).mockResolvedValue([]);
    vi.mocked(markMatchFinalized).mockResolvedValue(true);
    vi.mocked(getParticipants).mockResolvedValue([]);
    vi.mocked(propagateBracketOnMatchComplete).mockResolvedValue();
    vi.mocked(runEpbMatchdayHooks).mockResolvedValue();
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
    expect(markMatchFinalized).toHaveBeenCalledWith('match-1');
    expect(logAuditEvent).not.toHaveBeenCalled();
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

  it('does not run EPB matchday hooks for non-EPB seasons', async () => {
    await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
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
    expect(updateStreaks).toHaveBeenCalledTimes(2);
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
    expect(markMatchFinalized).toHaveBeenCalledWith('match-1');
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

  it('blocks the steps that need battle stats when the stats read fails, and runs the others', async () => {
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

    expect(result.failed_steps).toEqual(['battle_stats', 'streaks', 'announcements', 'epb_hooks']);
    expect(updateRatings).toHaveBeenCalled();
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).toHaveBeenCalledTimes(2);
    expect(updateStreaks).not.toHaveBeenCalled();
    expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[match-finalize] step "streaks" not run for match match-1: "battle_stats" failed'
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
      'epb_hooks',
      'bracket_propagation',
    ]);
    expect(updateRatings).toHaveBeenCalled();
    expect(updateStreaks).toHaveBeenCalledTimes(2);
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(checkAchievements).not.toHaveBeenCalled();
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

    expect(result.failed_steps).toEqual(['epb_hooks']);
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
      vi.mocked(recomputeStreaks).mockResolvedValue();
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
      expect(markMatchFinalized).toHaveBeenCalledWith('match-1');
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'match.finalize_healed',
          resource_id: 'match-1',
          metadata: expect.objectContaining({ not_rerun: ['achievements', 'announcements'] }),
        })
      );
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

    it('re-runs the EPB hooks only while the match has no snapshots', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        id: 'tournament-1',
        name: 'EvoLiga',
        season_id: 'season-1',
        season_format_type: 'evolution_point_buy',
      } as never);
      vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', round_number: 5 } as never);

      const result = await healMatchFinalization(completed);

      expect(result.healed).toBe(true);
      expect(runEpbMatchdayHooks).toHaveBeenCalledWith({
        match: completed,
        seasonId: 'season-1',
        matchday: 5,
        battleStats: [],
      });

      vi.mocked(runEpbMatchdayHooks).mockClear();
      vi.mocked(getMatchSnapshots).mockResolvedValue([{ match_id: 'match-1' }] as never);

      const second = await healMatchFinalization(completed);

      expect(second.healed).toBe(true);
      expect(runEpbMatchdayHooks).not.toHaveBeenCalled();
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
      expect(markMatchFinalized).toHaveBeenCalledWith('match-1');
    });

    it('propagates a failed rating-scope read as a failed ratings verify (retried next run)', async () => {
      vi.mocked(loadRatingScope).mockRejectedValueOnce(new Error('seasons read failed'));

      const result = await healMatchFinalization(completed);

      expect(result).toEqual({ healed: false, failed_steps: ['ratings'] });
      expect(markMatchFinalized).not.toHaveBeenCalled();
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
