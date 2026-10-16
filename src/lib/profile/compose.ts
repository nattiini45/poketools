import { getPlayerById, getPlayerParticipations } from '@/lib/supabase/queries/players';
import { getMatchesByPlayerWithTournament } from '@/lib/supabase/queries/matches';
import { compareMatchesByScheduledAt } from '@/lib/match/compare-scheduled-at';
import { getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
import { getPlayerBattleStats } from '@/lib/supabase/queries/games';
import { getGlobalKillRankForPokemon, getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { listTournamentsByIds, getParticipantsBatch } from '@/lib/supabase/queries/tournaments';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import {
  computeStandingsFromContext,
  loadSeasonStandingsContexts,
  NO_SEASON_CONTEXT,
} from '@/lib/tournament/season-standings';
import type { MatchWithTournament } from '@/lib/supabase/queries/matches';
import type { MatchStatus } from '@/types/match';
import type { PlayerAggregate } from '@/types/game';
import type {
  PlayerProfile,
  ProfileParticipation,
  ProfileMatch,
  ProfilePokemonStat,
  ProfileKillRanking,
  ProfileHeadlineStats,
  ProfileTrophy,
  PlayerBattleStatRow,
} from '@/types/profile';

/**
 * Compose a complete player profile by aggregating data from multiple tables.
 * Called by both the server page (direct) and the API route.
 *
 * Query shape (D36 fix 11): the player row, one parallel wave of the
 * player-scoped reads, then two independent chains side by side — the
 * participations' standings (`loadParticipationStandings`: tournaments, then
 * ONE batched pass for every table) and the global kill-rank read, which only
 * needs the battle stats.
 *
 * NOTE: `player` is the full row. Callers that expose the profile to anyone
 * but the player themselves or an admin must redact it first (see
 * `src/lib/profile/redact.ts` and `src/lib/players/public-player.ts`).
 */
export async function composePlayerProfile(
  playerId: string
): Promise<PlayerProfile | null> {
  const player = await getPlayerById(playerId);
  if (!player) return null;

  // Parallel fetch: profile baseline + gamification slices
  const [
    participations,
    allMatches,
    battleStats,
    playerAggregates,
    playerRating,
    playerStreaks,
    playerSignatures,
    playerAchievements,
  ] = await Promise.all([
    getPlayerParticipations(playerId),
    getMatchesByPlayerWithTournament(playerId),
    getPlayerBattleStats(playerId),
    getAllTimePlayerAggregates(playerId),
    getPlayerRating(playerId),
    getPlayerStreaks(playerId),
    getPlayerSignatures(playerId),
    getPlayerAchievements(playerId),
  ]);

  // Two independent chains: the participations' standings, and the global
  // kill ranks (which depend on the battle stats alone).
  const [{ tournaments, standingsMap }, best_kill_pokemon] = await Promise.all([
    loadParticipationStandings(playerId, participations.tournamentIds),
    computeBestKillPokemon(battleStats),
  ]);

  // Group battle stats by tournament for "best Pokémon" per participation
  const bestPokemonByTournament = computeBestPokemonByTournament(battleStats);

  // Build participations
  const current_participations: ProfileParticipation[] = [];
  const past_participations: ProfileParticipation[] = [];

  for (const t of tournaments) {
    const participation: ProfileParticipation = {
      id: t.id,
      name: t.name,
      type: 'tournament',
      status: t.status,
      bracket_type: t.bracket_type,
      standing: standingsMap.get(t.id) ?? null,
      best_pokemon: bestPokemonByTournament.get(t.id) ?? null,
    };

    if (t.status === 'completed') {
      past_participations.push(participation);
    } else {
      current_participations.push(participation);
    }
  }

  // Split matches into upcoming and recent (same status filter + sort as getUpcomingMatches)
  const upcoming_matches = buildProfileMatches(
    allMatches
      .filter((m) => m.status === 'scheduled' || m.status === 'in_progress')
      .sort(compareMatchesByScheduledAt),
    playerId
  ).slice(0, 10);

  const completedMatches = allMatches
    .filter((m) => m.status === 'completed')
    .sort((a, b) => {
      const da = a.date_played ?? a.created_at;
      const db = b.date_played ?? b.created_at;
      return db.localeCompare(da);
    });

  const recent_matches = buildProfileMatches(completedMatches.slice(0, 10), playerId);

  // Most Used reads pre-computed player_aggregates (wiki player filter semantics).
  // Kill rankings still scan battle_stats (allowed carve-out); they were
  // computed above, alongside the standings.
  const most_used_pokemon = computeMostUsedPokemonFromAggregates(playerAggregates);

  // Compute headline stats
  const headline = computeHeadlineStats(allMatches, battleStats, playerId, standingsMap);

  // Recent form: last 5 completed matches
  const recent_form = completedMatches.slice(0, 5).map((m): 'W' | 'L' | 'D' => {
    if (!m.winner_id) return 'D';
    return m.winner_id === playerId ? 'W' : 'L';
  });

  // Trophies: top-3 finishes in completed tournaments
  const trophies: ProfileTrophy[] = [];
  for (const t of tournaments) {
    if (t.status !== 'completed') continue;
    const standing = standingsMap.get(t.id);
    if (standing && standing.rank >= 1 && standing.rank <= 3) {
      trophies.push({
        id: t.id,
        name: t.name,
        rank: standing.rank as 1 | 2 | 3,
      });
    }
  }

  return {
    player,
    headline,
    current_participations,
    past_participations,
    upcoming_matches,
    recent_matches,
    most_used_pokemon,
    best_kill_pokemon,
    recent_form,
    trophies,
    rating: playerRating,
    streaks: playerStreaks,
    signatures: playerSignatures?.signatures ?? [],
    achievements: playerAchievements,
  };
}

// ─── Helper functions ───────────────────────────────────────────────

type ParticipationStanding = { rank: number; total: number; wins: number; losses: number };

/**
 * The player's tournaments and their standing in each active or completed
 * one. Every table is computed from ONE batched pass: participants, completed
 * records and the seasons' standings contexts (one seasons read, plus one
 * evolution-points read per distinct EPB season) — not a season lookup per
 * tournament.
 */
async function loadParticipationStandings(
  playerId: string,
  tournamentIds: string[]
): Promise<{
  tournaments: Awaited<ReturnType<typeof listTournamentsByIds>>;
  standingsMap: Map<string, ParticipationStanding>;
}> {
  const tournaments = await listTournamentsByIds(tournamentIds);

  const standingsMap = new Map<string, ParticipationStanding>();
  const tournamentsNeedingStandings = tournaments.filter(
    (t) => t.status === 'active' || t.status === 'completed'
  );

  const standingsTournamentIds = tournamentsNeedingStandings.map((t) => t.id);
  const [participantsByTournament, matchRecordsByTournament, seasonContexts] = await Promise.all([
    getParticipantsBatch(standingsTournamentIds),
    getCompletedMatchRecordsBatch(standingsTournamentIds),
    // Disclosed fallback, as before this batching: a failed season lookup
    // costs the season-bound tournaments their standing, never the profile.
    loadSeasonStandingsContexts(tournamentsNeedingStandings.map((t) => t.season_id)).catch(
      (err: unknown) => {
        console.error(
          '[profile/compose] season standings contexts failed — season tournaments show no standing:',
          err
        );
        return null;
      }
    ),
  ]);

  for (const t of tournamentsNeedingStandings) {
    if (t.season_id && seasonContexts === null) continue;
    try {
      const participants = participantsByTournament.get(t.id) ?? [];
      const matchRecords = matchRecordsByTournament.get(t.id) ?? [];

      const participantIds = participants.map((p) => p.id);
      const participantNames: Record<string, string> = {};
      for (const p of participants) participantNames[p.id] = p.name;

      const context = (t.season_id ? seasonContexts?.get(t.season_id) : undefined) ?? NO_SEASON_CONTEXT;
      const standings = computeStandingsFromContext(context, participantIds, participantNames, matchRecords);
      const playerIdx = standings.findIndex((s) => s.player_id === playerId);
      if (playerIdx !== -1) {
        standingsMap.set(t.id, {
          rank: playerIdx + 1,
          total: standings.length,
          wins: standings[playerIdx].wins,
          losses: standings[playerIdx].losses,
        });
      }
    } catch (err) {
      // One tournament's table failing must not take the whole profile down;
      // that participation then shows no standing. Logged, never silent.
      console.error(`[profile/compose] standings failed for tournament ${t.id}:`, err);
    }
  }

  return { tournaments, standingsMap };
}

function buildProfileMatches(
  matches: MatchWithTournament[],
  playerId: string
): ProfileMatch[] {
  return matches.map((m) => {
    const isPlayer1 = m.player_1_id === playerId;
    const opponentId = isPlayer1 ? m.player_2_id : m.player_1_id;
    const opponentName = isPlayer1 ? m.player_2_name : m.player_1_name;
    const opponentAvatar = isPlayer1 ? m.player_2_avatar_url : m.player_1_avatar_url;

    // Compute game score
    let p1Wins = 0;
    let p2Wins = 0;
    for (const g of m.games) {
      if (g.winner_id === m.player_1_id) p1Wins++;
      else if (g.winner_id === m.player_2_id) p2Wins++;
    }
    const myWins = isPlayer1 ? p1Wins : p2Wins;
    const theirWins = isPlayer1 ? p2Wins : p1Wins;

    return {
      id: m.id,
      tournament_id: m.tournament_id,
      tournament_name: m.tournament_name,
      opponent_id: opponentId,
      opponent_name: opponentName,
      opponent_avatar_url: opponentAvatar,
      status: m.status as MatchStatus,
      winner_id: m.winner_id,
      date_played: m.date_played,
      game_score: `${myWins}-${theirWins}`,
    };
  });
}

function computeBestPokemonByTournament(
  battleStats: PlayerBattleStatRow[]
): Map<string, { pokemon_name: string; kos_dealt: number }> {
  // Group by tournament_id + pokemon_name, sum kos_dealt
  const map = new Map<string, Map<string, number>>();
  for (const stat of battleStats) {
    if (!map.has(stat.tournament_id)) map.set(stat.tournament_id, new Map());
    const pokemonMap = map.get(stat.tournament_id)!;
    pokemonMap.set(
      stat.pokemon_name,
      (pokemonMap.get(stat.pokemon_name) ?? 0) + stat.kos_dealt
    );
  }

  const result = new Map<string, { pokemon_name: string; kos_dealt: number }>();
  Array.from(map.entries()).forEach(([tournamentId, pokemonMap]) => {
    let bestName = '';
    let bestKos = 0;
    Array.from(pokemonMap.entries()).forEach(([name, kos]) => {
      if (kos > bestKos) {
        bestName = name;
        bestKos = kos;
      }
    });
    if (bestName) {
      result.set(tournamentId, { pokemon_name: bestName, kos_dealt: bestKos });
    }
  });
  return result;
}

function computeMostUsedPokemonFromAggregates(
  playerAggregates: PlayerAggregate[]
): ProfilePokemonStat[] {
  return playerAggregates
    .map((agg): ProfilePokemonStat => ({
      pokemon_name: agg.pokemon_name,
      total_games: agg.total_games,
      total_kos_dealt: agg.total_kos_dealt,
      total_koed: agg.total_koed,
      kill_differential: agg.total_kos_dealt - agg.total_koed,
      win_rate: agg.total_games > 0
        ? Math.round((agg.total_wins / agg.total_games) * 100)
        : 0,
    }))
    .sort((a, b) => b.total_games - a.total_games)
    .slice(0, 3);
}

async function computeBestKillPokemon(
  battleStats: PlayerBattleStatRow[]
): Promise<ProfileKillRanking[]> {
  // Player's Pokémon by KOs dealt
  const pokemonKos = new Map<string, number>();
  for (const stat of battleStats) {
    pokemonKos.set(stat.pokemon_name, (pokemonKos.get(stat.pokemon_name) ?? 0) + stat.kos_dealt);
  }

  const playerTopKillers = Array.from(pokemonKos.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (playerTopKillers.length === 0) return [];

  // Targeted query: fetch global rank for only these 3 Pokémon (not all 1000+)
  const { rankings, totalRanked } = await getGlobalKillRankForPokemon(
    playerTopKillers.map(([name]) => name)
  );

  return playerTopKillers.map(([name, kos]): ProfileKillRanking => {
    const ranking = rankings.get(name);
    return {
      pokemon_name: name,
      kos_dealt: kos,
      rank: ranking?.rank ?? totalRanked + 1,
      total_ranked: totalRanked,
    };
  });
}

function computeHeadlineStats(
  allMatches: MatchWithTournament[],
  battleStats: PlayerBattleStatRow[],
  playerId: string,
  standingsMap: Map<string, { rank: number; total: number; wins: number; losses: number }>
): ProfileHeadlineStats {
  const completedMatches = allMatches.filter((m) => m.status === 'completed');
  const totalMatches = completedMatches.length;
  const totalWins = completedMatches.filter((m) => m.winner_id === playerId).length;
  const totalLosses = completedMatches.filter(
    (m) => m.winner_id !== null && m.winner_id !== playerId
  ).length;

  let totalKos = 0;
  const uniquePokemon = new Set<string>();
  for (const stat of battleStats) {
    totalKos += stat.kos_dealt;
    uniquePokemon.add(stat.pokemon_name);
  }

  // Count unique tournaments entered
  const tournamentIds = new Set(allMatches.map((m) => m.tournament_id));

  // Count tournaments won (rank === 1)
  let tournamentsWon = 0;
  Array.from(standingsMap.values()).forEach((standing) => {
    if (standing.rank === 1) tournamentsWon++;
  });

  return {
    total_matches: totalMatches,
    total_wins: totalWins,
    total_losses: totalLosses,
    win_rate: totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0,
    total_kos_dealt: totalKos,
    unique_pokemon_used: uniquePokemon.size,
    tournaments_entered: tournamentIds.size,
    tournaments_won: tournamentsWon,
  };
}
