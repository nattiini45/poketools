import {
  getPlayerAchievementKeys,
  listAchievementDefinitions,
  upsertPlayerAchievement,
} from '@/lib/supabase/queries/achievements';
import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchById, getMatchesByRound } from '@/lib/supabase/queries/matches';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getParticipants, getTournamentsByPlayer } from '@/lib/supabase/queries/tournaments';
import type { AchievementCriteria, EarnedAchievement } from '@/types/achievement';

interface MatchStatsSummary {
  kos_dealt_total: number;
  kos_lost_total: number;
  pokemon_brought: number;
  lead_same_pokemon: number;
}

interface AchievementStatsContext {
  matchStats: MatchStatsSummary;
  cumulativeStats: {
    total_wins: number;
    total_games: number;
    total_kos_dealt: number;
    total_tournaments: number;
  };
  streaks: {
    win_streak: number;
    ko_streak: number;
    flawless_streak: number;
  };
  metaStats: {
    used_unique_pokemon: number;
    won_with_all_types: number;
    won_all_bracket_types: number;
    signature_slots: number;
  };
  seedDiff: number;
  rating: {
    rating: number;
    peak_rating: number;
  };
  custom: {
    tournamentFinalWin: boolean;
    backToBackFinalWins: boolean;
  };
}

export interface MatchContext {
  match_id: string;
  tournament_id: string;
  season_id: string | null;
  winner_id: string;
  loser_id: string;
  is_draw: boolean;
}

type UnknownCriteria = AchievementCriteria | { type: string; [key: string]: unknown };

function compareValue(actual: number, op: 'eq' | 'gte' | 'lte', target: number): boolean {
  if (op === 'eq') return actual === target;
  if (op === 'gte') return actual >= target;
  return actual <= target;
}

function computeMatchStats(
  groupedMatchStats: Record<string, Array<{
    game_id: string;
    player_id: string;
    was_brought: boolean;
    was_lead: boolean;
    pokemon_name: string;
    was_koed: boolean;
    kos_dealt: number;
  }>>,
  playerId: string
): MatchStatsSummary {
  const allStats = Object.values(groupedMatchStats).flat().filter((s) => s.player_id === playerId);

  const kosDealtTotal = allStats.reduce((sum, s) => sum + s.kos_dealt, 0);
  const kosLostTotal = allStats.filter((s) => s.was_koed).length;
  const pokemonBrought = new Set(
    allStats.filter((s) => s.was_brought).map((s) => s.pokemon_name)
  ).size;

  const totalGames = Object.keys(groupedMatchStats).length;
  const leadsByGame = new Map<string, Set<string>>();
  for (const stat of allStats) {
    if (!stat.was_lead) continue;
    if (!leadsByGame.has(stat.game_id)) {
      leadsByGame.set(stat.game_id, new Set<string>());
    }
    leadsByGame.get(stat.game_id)!.add(stat.pokemon_name);
  }

  let leadSamePokemon = 0;
  if (totalGames > 0 && leadsByGame.size === totalGames) {
    const leadNames = Array.from(leadsByGame.values())
      .map((set) => Array.from(set)[0])
      .filter(Boolean);
    if (leadNames.length === totalGames && new Set(leadNames).size === 1) {
      leadSamePokemon = 1;
    }
  }

  return {
    kos_dealt_total: kosDealtTotal,
    kos_lost_total: kosLostTotal,
    pokemon_brought: pokemonBrought,
    lead_same_pokemon: leadSamePokemon,
  };
}

async function didPlayerWinTournamentFinal(playerId: string, tournamentId: string): Promise<boolean> {
  const rounds = await getRoundsByTournament(tournamentId);
  if (rounds.length === 0) return false;

  const maxRoundNumber = Math.max(...rounds.map((r) => r.round_number));
  const finalRounds = rounds.filter((r) => r.round_number === maxRoundNumber);

  for (const round of finalRounds) {
    const matches = await getMatchesByRound(round.id);
    if (matches.some((m) => m.status === 'completed' && m.winner_id === playerId)) {
      return true;
    }
  }

  return false;
}

async function buildStatsContext(
  playerId: string,
  matchContext: MatchContext
): Promise<AchievementStatsContext> {
  const [allTimeAggregates, playerStreaks, playerRating, matchBattleStats, participants, signatures, tournaments, match] =
    await Promise.all([
      getAllTimePlayerAggregates(playerId),
      getPlayerStreaks(playerId),
      getPlayerRating(playerId),
      getBattleStatsByMatch(matchContext.match_id),
      getParticipants(matchContext.tournament_id),
      getPlayerSignatures(playerId),
      getTournamentsByPlayer(playerId),
      getMatchById(matchContext.match_id),
    ]);

  const playerSeed = participants.find((p) => p.id === playerId)?.seed;
  const opponentId = playerId === matchContext.winner_id ? matchContext.loser_id : matchContext.winner_id;
  const opponentSeed = participants.find((p) => p.id === opponentId)?.seed;
  const seedDiff = playerSeed !== null && playerSeed !== undefined && opponentSeed !== null && opponentSeed !== undefined
    ? playerSeed - opponentSeed
    : 0;

  const totalWins = playerRating?.wins ?? 0;
  const totalGames = playerRating ? (playerRating.wins + playerRating.losses + playerRating.draws) : 0;

  const totalKosDealt = allTimeAggregates.reduce((sum, row) => sum + row.total_kos_dealt, 0);
  const usedUniquePokemon = allTimeAggregates.filter((row) => row.total_brought > 0).length;

  let tournamentFinalWin = false;
  if (match && playerId === matchContext.winner_id) {
    const round = await getRoundById(match.round_id);
    if (round) {
      const rounds = await getRoundsByTournament(matchContext.tournament_id);
      const maxRoundNumber = rounds.length > 0 ? Math.max(...rounds.map((r) => r.round_number)) : -1;
      tournamentFinalWin = round.round_number === maxRoundNumber;
    }
  }

  let backToBackFinalWins = false;
  if (tournamentFinalWin) {
    const completed = tournaments
      .filter((t) => t.status === 'completed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const currentIndex = completed.findIndex((t) => t.id === matchContext.tournament_id);
    const previousTournament = currentIndex >= 0 ? completed[currentIndex + 1] : null;

    if (previousTournament) {
      backToBackFinalWins = await didPlayerWinTournamentFinal(playerId, previousTournament.id);
    }
  }

  return {
    matchStats: computeMatchStats(matchBattleStats, playerId),
    cumulativeStats: {
      total_wins: totalWins,
      total_games: totalGames,
      total_kos_dealt: totalKosDealt,
      total_tournaments: tournaments.length,
    },
    streaks: {
      win_streak: playerStreaks?.current_win_streak ?? 0,
      ko_streak: playerStreaks?.current_ko_streak ?? 0,
      flawless_streak: playerStreaks?.current_flawless_streak ?? 0,
    },
    metaStats: {
      used_unique_pokemon: usedUniquePokemon,
      won_with_all_types: 0,
      won_all_bracket_types: 0,
      signature_slots: signatures?.signatures.length ?? 0,
    },
    seedDiff,
    rating: {
      rating: playerRating?.rating ?? 0,
      peak_rating: playerRating?.peak_rating ?? 0,
    },
    custom: {
      tournamentFinalWin,
      backToBackFinalWins,
    },
  };
}

function evaluateCriteria(criteria: UnknownCriteria, stats: AchievementStatsContext): boolean {
  switch (criteria.type) {
    case 'single_match': {
      const stat = criteria.stat;
      const value = typeof criteria.value === 'number' ? criteria.value : 0;
      const op = criteria.op === 'eq' || criteria.op === 'gte' || criteria.op === 'lte' ? criteria.op : 'gte';
      const actual = stats.matchStats[stat as keyof MatchStatsSummary] ?? 0;
      return compareValue(actual, op, value);
    }
    case 'cumulative': {
      const stat = criteria.stat as keyof AchievementStatsContext['cumulativeStats'];
      const value = typeof criteria.value === 'number' ? criteria.value : 0;
      const actual = stats.cumulativeStats[stat] ?? 0;
      return compareValue(actual, 'gte', value);
    }
    case 'streak': {
      const stat = criteria.stat as keyof AchievementStatsContext['streaks'];
      const value = typeof criteria.value === 'number' ? criteria.value : 0;
      const actual = stats.streaks[stat] ?? 0;
      return compareValue(actual, 'gte', value);
    }
    case 'meta': {
      const condition = criteria.condition as keyof AchievementStatsContext['metaStats'];
      const value = typeof criteria.value === 'number' ? criteria.value : 0;
      const actual = stats.metaStats[condition] ?? 0;
      return compareValue(actual, 'gte', value);
    }
    case 'seed_diff': {
      const value = typeof criteria.value === 'number' ? criteria.value : 0;
      return compareValue(stats.seedDiff, 'gte', value);
    }
    case 'rating': {
      const stat = criteria.stat as keyof AchievementStatsContext['rating'];
      const value = typeof criteria.value === 'number' ? criteria.value : 0;
      const actual = stats.rating[stat] ?? 0;
      return compareValue(actual, 'gte', value);
    }
    default:
      return false;
  }
}

export async function checkAchievements(
  playerId: string,
  matchContext: MatchContext
): Promise<EarnedAchievement[]> {
  const [definitions, earnedKeys, stats] = await Promise.all([
    listAchievementDefinitions(),
    getPlayerAchievementKeys(playerId),
    buildStatsContext(playerId, matchContext),
  ]);

  const unlocked: EarnedAchievement[] = [];
  const context = {
    match_id: matchContext.match_id,
    tournament_id: matchContext.tournament_id,
    season_id: matchContext.season_id ?? undefined,
  };

  for (const definition of definitions) {
    const hasEarned = earnedKeys.has(definition.key);
    if (hasEarned && !definition.repeatable) {
      continue;
    }

    let passed = false;
    if (definition.key === 'tournament_champ') {
      passed = stats.custom.tournamentFinalWin;
    } else if (definition.key === 'back_to_back') {
      passed = stats.custom.backToBackFinalWins;
    } else {
      passed = evaluateCriteria(definition.criteria as UnknownCriteria, stats);
    }

    if (!passed) {
      continue;
    }

    const saved = await upsertPlayerAchievement(playerId, definition.id, context);
    unlocked.push({
      ...definition,
      earned_at: saved.earned_at,
      times_earned: saved.times_earned,
      context: saved.context,
    });
  }

  return unlocked;
}
