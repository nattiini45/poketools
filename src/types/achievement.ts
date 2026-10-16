export type AchievementCategory = 'combat' | 'milestone' | 'social' | 'rare' | 'meta';
export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface AchievementDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  category: AchievementCategory;
  tier: AchievementTier;
  repeatable: boolean;
  hidden: boolean;
  criteria: AchievementCriteria;
}

export interface PlayerAchievement {
  id: string;
  player_id: string;
  achievement_id: string;
  earned_at: string;
  context: { match_id?: string; tournament_id?: string; season_id?: string } | null;
  times_earned: number;
}

/** Enriched achievement for display (definition + earned state) */
export interface EarnedAchievement extends AchievementDefinition {
  earned_at: string;
  times_earned: number;
  context: PlayerAchievement['context'];
}

export type AchievementCriteria =
  | SingleMatchCriteria
  | CumulativeCriteria
  | StreakCriteria
  | MetaCriteria
  | SeedDiffCriteria
  | RatingCriteria;

export type CriteriaOp = 'eq' | 'gte' | 'lte';

export interface SingleMatchCriteria {
  type: 'single_match';
  stat: 'kos_dealt_total' | 'kos_lost_total' | 'pokemon_brought' | 'lead_same_pokemon';
  op: CriteriaOp;
  value: number;
}

export interface CumulativeCriteria {
  type: 'cumulative';
  stat: 'total_wins' | 'total_games' | 'total_kos_dealt' | 'total_tournaments';
  op: 'gte';
  value: number;
}

export interface StreakCriteria {
  type: 'streak';
  stat: 'win_streak' | 'ko_streak' | 'flawless_streak';
  op: 'gte';
  value: number;
}

export interface MetaCriteria {
  type: 'meta';
  condition: 'used_unique_pokemon' | 'won_with_all_types' | 'won_all_bracket_types';
  op: 'gte';
  value: number;
}

export interface SeedDiffCriteria {
  type: 'seed_diff';
  condition: 'winner_seed_minus_loser_seed';
  op: 'gte';
  value: number;
}

export interface RatingCriteria {
  type: 'rating';
  stat: 'rating' | 'peak_rating';
  op: 'gte';
  value: number;
}
