import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { finalizeMatchCompletion } from '../finalize';
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
import { updateStreaks } from '@/lib/gamification/streaks';
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
  });

  it('runs shared completion side effects once for newly completed matches', async () => {
    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.finalized).toBe(true);
    expect(revalidateMatchPages).toHaveBeenCalledWith('tournament-1', 'match-1');
    expect(updateRatings).toHaveBeenCalledWith('player-1', 'player-2', false, 'match-1');
    expect(updateSignatures).toHaveBeenCalledTimes(2);
    expect(emitDiscordEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'match_confirmed' }));
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
    vi.mocked(runEpbMatchdayHooks).mockRejectedValue(new Error('DB down'));

    const result = await finalizeMatchCompletion({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });

    expect(result.finalized).toBe(true);
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
});
