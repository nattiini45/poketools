import { revalidateMatchPages } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { propagateBracketOnMatchComplete } from '@/lib/tournament/bracket-propagation';
import { logAuditEvent } from '@/lib/audit/log';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { runEpbMatchdayHooks } from '@/lib/match/epb-matchday';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { buildGamePokemonStats, computePokemonScoreFromGameStats } from '@/lib/discord/helpers';
import { checkAchievements } from '@/lib/gamification/achievements';
import { updateSignatures } from '@/lib/gamification/signatures';
import { updateStreaks } from '@/lib/gamification/streaks';
import { updateRatings } from '@/lib/rating/updateRatings';
import type { MatchStatus, MatchWithPlayers } from '@/types/match';
import type { BattleStat } from '@/types/game';

interface FinalizeMatchCompletionInput {
  match: MatchWithPlayers;
  winnerId: string;
  previousStatus: MatchStatus;
}

export interface FinalizeMatchCompletionResult {
  finalized: boolean;
  reason?: string;
  propagation_failed?: boolean;
}

function aggregateMatchKOs(
  stats: BattleStat[],
  playerId: string
): { total_kos_dealt: number; total_kos_lost: number } {
  let totalKosDealt = 0;
  let totalKosLost = 0;

  for (const stat of stats) {
    if (stat.player_id !== playerId) continue;
    totalKosDealt += stat.kos_dealt;
    if (stat.was_koed) totalKosLost += 1;
  }

  return {
    total_kos_dealt: totalKosDealt,
    total_kos_lost: totalKosLost,
  };
}

export async function finalizeMatchCompletion({
  match,
  winnerId,
  previousStatus,
}: FinalizeMatchCompletionInput): Promise<FinalizeMatchCompletionResult> {
  if (previousStatus === 'completed') {
    return { finalized: false, reason: 'already_completed' };
  }
  if (winnerId !== match.player_1_id && winnerId !== match.player_2_id) {
    return { finalized: false, reason: 'winner_not_participant' };
  }

  await revalidateMatchPages(match.tournament_id, match.id);

  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament) {
    return { finalized: true, reason: 'missing_tournament' };
  }

  const loserId = winnerId === match.player_1_id
    ? match.player_2_id
    : match.player_1_id;

  const matchContext = {
    match_id: match.id,
    tournament_id: match.tournament_id,
    season_id: tournament.season_id ?? null,
    winner_id: winnerId,
    loser_id: loserId,
    is_draw: false,
  };

  const ratingChanges = await updateRatings(winnerId, loserId, false, match.id);

  const statsByGame = await getBattleStatsByMatch(match.id);
  const flatStats = Object.values(statsByGame).flat();
  const winnerStats = aggregateMatchKOs(flatStats, winnerId);
  const loserStats = aggregateMatchKOs(flatStats, loserId);

  const [winnerStreaks, loserStreaks] = await Promise.all([
    updateStreaks(winnerId, { won: true, lost: false, drew: false }, winnerStats, match.id),
    updateStreaks(loserId, { won: false, lost: true, drew: false }, loserStats, match.id),
  ]);

  await Promise.all([
    updateSignatures(winnerId),
    updateSignatures(loserId),
  ]);

  const [winnerAchievements, loserAchievements] = await Promise.all([
    checkAchievements(winnerId, matchContext),
    checkAchievements(loserId, matchContext),
  ]);

  const gameStats = buildGamePokemonStats(match, statsByGame);
  const pokScore = computePokemonScoreFromGameStats(
    gameStats,
    match.player_1_name,
    match.player_2_name
  );
  const replayUrl = match.games.find((game) => game.replay_url)?.replay_url;
  const winnerName = winnerId === match.player_1_id ? match.player_1_name : match.player_2_name;
  const loserName = winnerId === match.player_1_id ? match.player_2_name : match.player_1_name;

  const matchConfirmedPayload = {
    event_type: 'match_confirmed' as const,
    tournament_id: match.tournament_id,
    season_id: tournament.season_id,
    data: {
      kind: 'match_confirmed' as const,
      player_1_name: match.player_1_name,
      player_2_name: match.player_2_name,
      player_1_avatar_url: match.player_1_avatar_url,
      player_2_avatar_url: match.player_2_avatar_url,
      winner_name: winnerName,
      game_score: `${pokScore.p1}-${pokScore.p2}`,
      replay_url: replayUrl || undefined,
      tournament_name: tournament.name,
      game_stats: gameStats,
    },
  };
  void emitDiscordEvent(matchConfirmedPayload);
  void emitSocialEvent({
    ...matchConfirmedPayload,
    imageUrl: match.social_image_url || undefined,
  });

  for (const entry of [
    ...winnerAchievements.map((achievement) => ({ achievement, player_name: winnerName })),
    ...loserAchievements.map((achievement) => ({ achievement, player_name: loserName })),
  ]) {
    if (entry.achievement.tier !== 'gold' && entry.achievement.tier !== 'platinum') {
      continue;
    }

    const achievementPayload = {
      event_type: 'achievement_unlocked' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'achievement_unlocked' as const,
        player_name: entry.player_name,
        achievement_name: entry.achievement.name,
        achievement_key: entry.achievement.key,
        achievement_tier: entry.achievement.tier,
        achievement_icon: entry.achievement.icon,
        achievement_description: entry.achievement.description,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(achievementPayload);
    void emitSocialEvent(achievementPayload);
  }

  if (winnerStreaks.win_streak.after >= 5 && winnerStreaks.win_streak.after % 5 === 0) {
    const streakMilestonePayload = {
      event_type: 'streak_milestone' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'streak_milestone' as const,
        player_name: winnerName,
        streak_type: 'win' as const,
        streak_count: winnerStreaks.win_streak.after,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(streakMilestonePayload);
    void emitSocialEvent(streakMilestonePayload);
  }

  if (loserStreaks.win_streak.before >= 5 && loserStreaks.win_streak.after === 0) {
    const streakBrokenPayload = {
      event_type: 'streak_broken' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'streak_broken' as const,
        breaker_name: winnerName,
        broken_player_name: loserName,
        streak_count: loserStreaks.win_streak.before,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(streakBrokenPayload);
    void emitSocialEvent(streakBrokenPayload);
  }

  const thresholds = [
    { rating: 1600, key: 'rising_star' },
    { rating: 1700, key: 'ace_trainer' },
    { rating: 1800, key: 'elite_four' },
    { rating: 1900, key: 'champion_tier' },
  ] as const;

  for (const threshold of thresholds) {
    if (
      ratingChanges.winnerRating >= threshold.rating &&
      (ratingChanges.winnerRating - ratingChanges.winnerChange) < threshold.rating
    ) {
      const ratingPayload = {
        event_type: 'rating_milestone' as const,
        tournament_id: match.tournament_id,
        season_id: tournament.season_id,
        data: {
          kind: 'rating_milestone' as const,
          player_name: winnerName,
          new_rating: ratingChanges.winnerRating,
          threshold: threshold.key,
          tournament_name: tournament.name,
        },
      };
      void emitDiscordEvent(ratingPayload);
      void emitSocialEvent(ratingPayload);
    }
  }

  // ── Evolution Point Buy matchday hooks (EPB seasons only) ────────
  // Cosmo / stage recheck / lock / EP / snapshots are owned by
  // epb-matchday. Best-effort for match completion — bookkeeping must
  // never block finalization — but the orchestrator rolls back its own
  // writes on failure so partial EPB state does not stick.
  if (tournament.season_id && isEvolutionPointBuy(tournament.season_format_type ?? '')) {
    try {
      const seasonId = tournament.season_id;
      const round = await getRoundById(match.round_id);
      const matchday = round?.round_number ?? null;

      if (matchday === null) {
        console.error(`EPB finalize: round ${match.round_id} not found; matchday hooks skipped`);
      } else {
        await runEpbMatchdayHooks({
          match,
          seasonId,
          matchday,
          battleStats: flatStats,
        });
      }
    } catch (err) {
      console.error('EPB matchday hooks failed during match finalize', err);
    }
  }

  // Bracket propagation for elimination formats (synchronous — bracket integrity)
  let propagationFailed = false;
  if (
    tournament.bracket_type === 'single_elim' ||
    tournament.bracket_type === 'double_elim'
  ) {
    try {
      const participants = await getParticipants(match.tournament_id);
      await propagateBracketOnMatchComplete(
        { ...match, winner_id: winnerId, status: 'completed' },
        tournament,
        participants
      );
    } catch (err) {
      propagationFailed = true;
      console.error('Bracket propagation failed during match finalize', err);
      logAuditEvent({
        actor_id: null,
        actor_name: 'System',
        action: 'match.propagation_failed',
        resource_type: 'match',
        resource_id: match.id,
        resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
        metadata: {
          tournament_id: match.tournament_id,
          winner_id: winnerId,
        },
      });
    }
  }

  return {
    finalized: true,
    ...(propagationFailed ? { propagation_failed: true } : {}),
  };
}