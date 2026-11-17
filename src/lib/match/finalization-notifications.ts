import { buildGamePokemonStats, computePokemonScoreFromGameStats } from '@/lib/discord/helpers';
import type { MatchWithPlayers } from '@/types/match';
import type { MatchConfirmedData, AchievementUnlockedData, StreakMilestoneData, StreakBrokenData, RatingMilestoneData } from '@/types/discord';
import type { FinalizationAnnouncements } from './finalization-core';

type AnnouncementMatch = Omit<MatchWithPlayers, 'tournament_id'>;
export type FinalizationNotificationInput = Omit<FinalizationAnnouncements<AnnouncementMatch, never>, 'competition'>;

export type FinalizationNotification =
  | { event_type: 'match_confirmed'; data: Omit<MatchConfirmedData, 'tournament_name'>; imageUrl?: string }
  | { event_type: 'achievement_unlocked'; data: Omit<AchievementUnlockedData, 'tournament_name'> }
  | { event_type: 'streak_milestone'; data: Omit<StreakMilestoneData, 'tournament_name'> }
  | { event_type: 'streak_broken'; data: Omit<StreakBrokenData, 'tournament_name'> }
  | { event_type: 'rating_milestone'; data: Omit<RatingMilestoneData, 'tournament_name'> };

export function buildFinalizationNotifications(input: FinalizationNotificationInput): FinalizationNotification[] {
  const { match, winnerId, statsByGame, ratingChanges, streaks, achievements } = input;
  const gameStats = buildGamePokemonStats(match, statsByGame);
  const score = computePokemonScoreFromGameStats(gameStats, match.player_1_name, match.player_2_name);
  const replay = [...match.games].sort((a, b) => a.game_number - b.game_number).find(game => game.replay_url)?.replay_url;
  const winnerName = winnerId === match.player_1_id ? match.player_1_name : match.player_2_name;
  const loserName = winnerId === match.player_1_id ? match.player_2_name : match.player_1_name;
  const events: FinalizationNotification[] = [{
    event_type: 'match_confirmed', imageUrl: match.social_image_url || undefined,
    data: {
      kind: 'match_confirmed', player_1_name: match.player_1_name, player_2_name: match.player_2_name,
      player_1_avatar_url: match.player_1_avatar_url, player_2_avatar_url: match.player_2_avatar_url,
      winner_name: winnerName, game_score: `${score.p1}-${score.p2}`, replay_url: replay || undefined, game_stats: gameStats,
    },
  }];
  for (const entry of [
    ...(achievements?.winner ?? []).map(achievement => ({ achievement, player_name: winnerName })),
    ...(achievements?.loser ?? []).map(achievement => ({ achievement, player_name: loserName })),
  ]) {
    if (entry.achievement.tier !== 'gold' && entry.achievement.tier !== 'platinum') continue;
    events.push({ event_type: 'achievement_unlocked', data: {
      kind: 'achievement_unlocked', player_name: entry.player_name, achievement_name: entry.achievement.name,
      achievement_key: entry.achievement.key, achievement_tier: entry.achievement.tier,
      achievement_icon: entry.achievement.icon, achievement_description: entry.achievement.description,
    } });
  }
  if (streaks && streaks.winner.win_streak.after >= 5 && streaks.winner.win_streak.after % 5 === 0
    && streaks.winner.win_streak.after > streaks.winner.win_streak.before) {
    events.push({ event_type: 'streak_milestone', data: {
      kind: 'streak_milestone', player_name: winnerName, streak_type: 'win', streak_count: streaks.winner.win_streak.after,
    } });
  }
  if (streaks && streaks.loser.win_streak.before >= 5 && streaks.loser.win_streak.after === 0) {
    events.push({ event_type: 'streak_broken', data: {
      kind: 'streak_broken', breaker_name: winnerName, broken_player_name: loserName, streak_count: streaks.loser.win_streak.before,
    } });
  }
  if (ratingChanges) {
    const thresholds = [
      { rating: 1600, key: 'rising_star' }, { rating: 1700, key: 'ace_trainer' },
      { rating: 1800, key: 'elite_four' }, { rating: 1900, key: 'champion_tier' },
    ] as const;
    for (const threshold of thresholds) {
      if (ratingChanges.winnerRating >= threshold.rating
        && ratingChanges.winnerRating - ratingChanges.winnerChange < threshold.rating) {
        events.push({ event_type: 'rating_milestone', data: {
          kind: 'rating_milestone', player_name: winnerName, new_rating: ratingChanges.winnerRating, threshold: threshold.key,
        } });
      }
    }
  }
  return events;
}
