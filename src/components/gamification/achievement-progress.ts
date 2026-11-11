import type { AchievementDefinition } from '@/types/achievement';

/**
 * The numbers a profile already shows that an achievement's criteria count towards. Every field is optional: a
 * value the page does not hand over (streaks for a signed-out viewer) yields no progress.
 */
export interface AchievementProgressSource {
  totalWins?: number;
  totalGames?: number;
  totalKos?: number;
  totalTournaments?: number;
  uniquePokemon?: number;
  winStreak?: number;
  koStreak?: number;
  flawlessStreak?: number;
  rating?: number;
  peakRating?: number;
}

function currentValue(criteria: AchievementDefinition['criteria'], source: AchievementProgressSource): number | undefined {
  // The column is jsonb: a row may carry a criteria type the union does not list yet.
  const raw = criteria as { type?: string; stat?: string; condition?: string };
  const stat = raw.stat ?? '';
  let byStat: Record<string, number | undefined>;
  switch (raw.type) {
    case 'cumulative':
      byStat = { total_wins: source.totalWins, total_games: source.totalGames, total_kos_dealt: source.totalKos, total_tournaments: source.totalTournaments };
      return Object.hasOwn(byStat, stat) ? byStat[stat] : undefined;
    case 'streak':
      byStat = { win_streak: source.winStreak, ko_streak: source.koStreak, flawless_streak: source.flawlessStreak };
      return Object.hasOwn(byStat, stat) ? byStat[stat] : undefined;
    case 'meta':
      return raw.condition === 'used_unique_pokemon' ? source.uniquePokemon : undefined;
    case 'rating':
      byStat = { rating: source.rating, peak_rating: source.peakRating };
      return Object.hasOwn(byStat, stat) ? byStat[stat] : undefined;
    default:
      return undefined;
  }
}

/**
 * How far a locked achievement is, or null when the criteria are not a "reach N" count over a number the profile
 * has. A count already at its target is left out too: the award is written when a match is finalized.
 */
export function achievementProgress(
  definition: Pick<AchievementDefinition, 'criteria'>,
  source: AchievementProgressSource | undefined,
): { current: number; target: number } | null {
  if (!source) return null;
  const criteria = definition.criteria as { op?: string; value?: unknown };
  const target = criteria.value;
  if (criteria.op !== 'gte' || typeof target !== 'number' || target <= 1) return null;
  const current = currentValue(definition.criteria, source);
  if (current === undefined || current < 0 || current >= target) return null;
  return { current: Math.floor(current), target };
}
