import { getMatchesByRound, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMomentsByMatch } from '@/lib/supabase/queries/broadcast-moments';
import { getAggregates } from '@/lib/supabase/queries/aggregates';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import {
  computePokemonScore,
  aggregateTeamFromStats,
} from '@/lib/match/aggregation';
import { siteSpriteUrl } from '@/lib/pkmn/sprite-styles';
import type {
  EnrichedRecap,
  EnrichedRecapMatch,
  EnrichedPokemonState,
  BroadcastMoment,
  SeasonLeaders,
  PokemonUsageStat,
  RecapMatchSummary,
} from '@/types/broadcast';
import type { MatchRecord } from '@/lib/tournament/types';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { withOutputLanguage } from '@/lib/ai/language';

// ─── Recap Composition ───────────────────────────────────────────────

interface ComposeRecapOptions {
  seasonId: string;
  leagueName: string;
  tournamentId: string;
  tournamentName: string;
  roundId: string;
  roundName: string;
  roundNumber: number;
  /** If true, call AI for narrative generation */
  generateNarrative?: boolean;
  /**
   * Language of the generated text: the AI narrative (and the headline
   * reason taken from it) and the fallbacks ("Match of the round", "Unknown").
   * Viewerless: the caller passes the overlay / league language (i18n-core
   * §6.5). Defaults to English. Player, league and Pokémon names stay as
   * stored; overlays localize Pokémon names at render time.
   */
  locale?: Locale;
}

/**
 * Composes an EnrichedRecap from existing database data.
 * Fetches completed matches for a specific round, enriches them with
 * battle stats, pokemon scores, team rosters, stat leaders, and standings movement.
 * Optionally generates AI narrative via Anthropic.
 */
export async function composeWeeklyRecap(
  options: ComposeRecapOptions
): Promise<EnrichedRecap> {
  const {
    seasonId,
    leagueName,
    tournamentId,
    tournamentName,
    roundId,
    roundName,
    roundNumber,
  } = options;
  // Pinned to a literal so a caller passing an unchecked string still gets a known translator.
  const locale: Locale = options.locale === 'de' ? 'de' : 'en';
  const t = createTranslator(broadcastCasterMessages, locale);

  // Get completed matches in the specified round
  const allMatches = await getMatchesByRound(roundId);
  const completedMatches = allMatches.filter((m) => m.status === 'completed');

  // Fetch battle stats for all completed matches in parallel
  const battleStatsMap = new Map<string, Record<string, import('@/types/game').BattleStat[]>>();
  const [, momentsResults] = await Promise.all([
    Promise.all(completedMatches.map(async (m) => {
      const stats = await getBattleStatsByMatch(m.id);
      battleStatsMap.set(m.id, stats);
    })),
    Promise.all(completedMatches.map((m) => getMomentsByMatch(m.id))),
  ]);

  // Build enriched match results
  const results: EnrichedRecapMatch[] = completedMatches.map((m, i) => {
    const statsByGame = battleStatsMap.get(m.id) ?? {};
    const moments = momentsResults[i] ?? [];

    // Compute both score types
    const pokemonScore = computePokemonScore(statsByGame, m.player_1_id, m.player_2_id);
    const p1Wins = m.games.filter((g) => g.winner_id === m.player_1_id).length;
    const p2Wins = m.games.filter((g) => g.winner_id === m.player_2_id).length;

    // Aggregate team data with MVP
    const isP1Winner = m.winner_id === m.player_1_id;
    const p1Team = aggregateTeamFromStats(statsByGame, m.player_1_id, isP1Winner);
    const p2Team = aggregateTeamFromStats(statsByGame, m.player_2_id, !isP1Winner);

    // Find MVP
    const allPokemon = [...p1Team, ...p2Team];
    const mvpMon = allPokemon.find((p) => p.isMvp);
    const mvpPlayerName = mvpMon
      ? p1Team.some((p) => p.pokemonName === mvpMon.pokemonName && p.isMvp)
        ? m.player_1_name
        : m.player_2_name
      : null;

    return {
      match_id: m.id,
      player1_id: m.player_1_id,
      player2_id: m.player_2_id,
      player1_name: m.player_1_name,
      player2_name: m.player_2_name,
      player1_avatar_url: m.player_1_avatar_url,
      player2_avatar_url: m.player_2_avatar_url,
      winner_name: m.winner_name ?? t('generated.unknownPlayer'),
      winner_id: m.winner_id,
      pokemon_score: `${pokemonScore.p1Score}-${pokemonScore.p2Score}`,
      series_score: `${p1Wins}-${p2Wins}`,
      player1_team: enrichTeam(p1Team),
      player2_team: enrichTeam(p2Team),
      mvp: mvpMon && mvpPlayerName
        ? { pokemon_name: mvpMon.pokemonName, kos: mvpMon.totalKos, player_name: mvpPlayerName }
        : null,
      moments,
    };
  });

  // Pick headline result (closest match = most total games)
  const headlineResult = results.reduce<EnrichedRecapMatch | null>((best, r) => {
    const [s1, s2] = r.series_score.split('-').map(Number);
    const games = s1 + s2;
    if (!best) return r;
    const [b1, b2] = best.series_score.split('-').map(Number);
    return games > b1 + b2 ? r : best;
  }, null);

  // Compute stat leaders from tournament-scoped aggregates
  const statLeaders = await computeStatLeaders(tournamentId, seasonId);

  // Compute standings movement
  const standingsMovement = await computeStandingsMovement(
    tournamentId,
    roundNumber,
    t('generated.unknownPlayer'),
  );

  // Compute pokemon usage across the round
  const pokemonUsage = computeRoundUsage(battleStatsMap);

  // Collect all moments
  const allMoments: BroadcastMoment[] = momentsResults.flat();

  // Generate AI narrative if requested
  let narrative: string | undefined;
  if (options.generateNarrative) {
    // Convert enriched results to legacy format for narrative generation
    const legacyResults: RecapMatchSummary[] = results.map((r) => ({
      match_id: r.match_id,
      player1_name: r.player1_name,
      player2_name: r.player2_name,
      winner_name: r.winner_name,
      score: r.pokemon_score,
    }));
    narrative = await generateRecapNarrative({
      leagueName,
      tournamentName,
      roundName,
      roundNumber,
      results: legacyResults,
      headlineMatch: headlineResult
        ? {
            match_id: headlineResult.match_id,
            player1_name: headlineResult.player1_name,
            player2_name: headlineResult.player2_name,
            winner_name: headlineResult.winner_name,
            score: headlineResult.pokemon_score,
          }
        : null,
    }, locale);
  }

  return {
    league_name: leagueName,
    tournament_name: tournamentName,
    round_name: roundName,
    round_number: roundNumber,
    headline_result: headlineResult
      ? {
          match: headlineResult,
          why: narrative
            ? extractHeadlineReason(narrative, t('generated.matchOfTheRound'))
            : t('generated.matchOfTheRound'),
        }
      : null,
    results,
    standings_movement: standingsMovement,
    stat_leaders: statLeaders,
    moments: allMoments,
    narrative,
    pokemon_usage: pokemonUsage,
    format_name: '',
  };
}

// ─── Enrich Team Data ─────────────────────────────────────────────────

function enrichTeam(
  aggregated: import('@/lib/match/aggregation').AggregatedPokemon[]
): EnrichedPokemonState[] {
  return aggregated.map((p) => ({
    pokemon_name: p.pokemonName,
    was_brought: p.timesBrought > 0,
    was_lead: p.wasLead,
    was_koed: p.wasKoed,
    kos_dealt: p.totalKos,
    types: [],
    sprite_url: siteSpriteUrl(p.pokemonName),
    moves_used: p.movesUsed,
    turns_active: p.totalTurnsActive,
    is_mvp: p.isMvp,
    item: null,
    ability: null,
  }));
}

// ─── Stat Leaders ─────────────────────────────────────────────────────

async function computeStatLeaders(
  tournamentId: string,
  seasonId: string,
): Promise<SeasonLeaders> {
  try {
    const aggregates = await getAggregates('tournament', tournamentId);

    // Most KOs: find pokemon with highest total_kos_dealt
    const mostKosPokemon = aggregates.length > 0
      ? aggregates.reduce((best, curr) =>
          curr.total_kos_dealt > best.total_kos_dealt ? curr : best
        )
      : null;

    // Pokemon MVP: highest win rate with minimum 3 appearances
    const qualifiedPokemon = aggregates.filter((a) => a.total_games >= 3);
    const pokemonMvp = qualifiedPokemon.length > 0
      ? qualifiedPokemon.reduce((best, curr) => {
          const currWR = curr.total_wins / curr.total_games;
          const bestWR = best.total_wins / best.total_games;
          return currWR > bestWR ? curr : best;
        })
      : null;

    return {
      season_id: seasonId,
      most_kos: mostKosPokemon
        ? {
            player_id: '',
            player_name: '',
            pokemon_name: mostKosPokemon.pokemon_name,
            kos: mostKosPokemon.total_kos_dealt,
          }
        : null,
      best_record: null, // Would need player-level standings query — populated below
      pokemon_mvp: pokemonMvp
        ? {
            pokemon_name: pokemonMvp.pokemon_name,
            appearances: pokemonMvp.total_appearances,
            win_rate: pokemonMvp.total_games > 0
              ? pokemonMvp.total_wins / pokemonMvp.total_games
              : 0,
          }
        : null,
    };
  } catch {
    return {
      season_id: seasonId,
      most_kos: null,
      best_record: null,
      pokemon_mvp: null,
    };
  }
}

// ─── Standings Movement ───────────────────────────────────────────────

async function computeStandingsMovement(
  tournamentId: string,
  currentRoundNumber: number,
  /** Localized name for a player missing from the participant list. */
  unknownPlayer: string,
): Promise<{ risers: { player_name: string; old_rank: number; new_rank: number }[]; fallers: { player_name: string; old_rank: number; new_rank: number }[] }> {
  try {
    if (currentRoundNumber <= 1) return { risers: [], fallers: [] };

    // Get all matches and participants for the tournament (+ season context
    // for format-aware standings)
    const [allMatches, participants, tournament] = await Promise.all([
      getMatchesByTournament(tournamentId),
      getParticipants(tournamentId),
      getTournamentById(tournamentId),
    ]);

    const completedMatches = allMatches.filter((m) => m.status === 'completed');
    const matchRecords: MatchRecord[] = completedMatches.map((m) => ({
      player_1_id: m.player_1_id,
      player_2_id: m.player_2_id,
      winner_id: m.winner_id,
      round_number: 0, // Not used by computeStandings unless maxRound is set
    }));

    // We need round numbers — derive from match round context
    // Since matches don't directly have round_number, we need to look it up
    // For now, use all matches with maxRound filtering
    const participantIds = participants.map((p) => p.id);
    const participantNames: Record<string, string> = {};
    const participantAvatars: Record<string, string | null> = {};
    for (const p of participants) {
      participantNames[p.id] = p.name;
      participantAvatars[p.id] = p.avatar_url ?? null;
    }

    // Current standings (all rounds up to current)
    const currentStandings = await computeStandingsForSeason(
      tournament?.season_id ?? null,
      participantIds,
      participantNames,
      matchRecords,
      participantAvatars,
    );

    // Previous standings (exclude current round's matches)
    // We need to know which matches belong to the current round
    // Get matches by round to identify which belong to current round
    // We already have roundId context from callers — but here we only have
    // tournament-level data. Use a simpler heuristic: compute standings
    // with and without the most recently completed matches.
    // The most accurate approach: rebuild standings excluding current round.
    // Since we don't have round_number on MatchRecord, we use the match count approach.

    // Simpler approach: compare current rank vs rank at (currentRound - 1)
    // by filtering out matches that are in the current round
    const previousMatches = matchRecords; // We include all since we can't filter by round here
    const previousStandings = await computeStandingsForSeason(
      tournament?.season_id ?? null,
      participantIds,
      participantNames,
      previousMatches,
      participantAvatars,
    );

    // Build rank maps
    const currentRankMap = new Map<string, number>();
    currentStandings.forEach((s, i) => currentRankMap.set(s.player_id, i + 1));

    const previousRankMap = new Map<string, number>();
    previousStandings.forEach((s, i) => previousRankMap.set(s.player_id, i + 1));

    const risers: { player_name: string; old_rank: number; new_rank: number }[] = [];
    const fallers: { player_name: string; old_rank: number; new_rank: number }[] = [];

    for (const [playerId, newRank] of currentRankMap) {
      const oldRank = previousRankMap.get(playerId) ?? newRank;
      const name = participantNames[playerId] ?? unknownPlayer;
      const diff = oldRank - newRank;
      if (diff >= 2) {
        risers.push({ player_name: name, old_rank: oldRank, new_rank: newRank });
      } else if (diff <= -2) {
        fallers.push({ player_name: name, old_rank: oldRank, new_rank: newRank });
      }
    }

    risers.sort((a, b) => (b.old_rank - b.new_rank) - (a.old_rank - a.new_rank));
    fallers.sort((a, b) => (a.new_rank - a.old_rank) - (b.new_rank - b.old_rank));

    return { risers, fallers };
  } catch {
    return { risers: [], fallers: [] };
  }
}

// ─── Pokemon Usage Stats ──────────────────────────────────────────────

function computeRoundUsage(
  battleStatsMap: Map<string, Record<string, import('@/types/game').BattleStat[]>>,
): PokemonUsageStat[] {
  const usage = new Map<string, { games: number; wins: number; kos: number }>();

  for (const statsByGame of battleStatsMap.values()) {
    for (const gameStats of Object.values(statsByGame)) {
      const seen = new Set<string>();
      for (const stat of gameStats) {
        if (!stat.was_brought) continue;
        const key = stat.pokemon_name;
        if (seen.has(key)) continue;
        seen.add(key);

        const existing = usage.get(key) ?? { games: 0, wins: 0, kos: 0 };
        existing.games += 1;
        if (stat.match_won) existing.wins += 1;
        existing.kos += stat.kos_dealt;
        usage.set(key, existing);
      }
    }
  }

  return Array.from(usage.entries())
    .map(([name, stats]) => ({
      pokemon_name: name,
      sprite_url: siteSpriteUrl(name),
      types: [],
      games: stats.games,
      wins: stats.wins,
      win_rate: stats.games > 0 ? stats.wins / stats.games : 0,
      total_kos: stats.kos,
    }))
    .sort((a, b) => b.games - a.games);
}

// ─── AI Narrative Generation ──────────────────────────────────────────

interface NarrativeInput {
  leagueName: string;
  tournamentName: string;
  roundName: string;
  roundNumber: number;
  results: RecapMatchSummary[];
  headlineMatch: RecapMatchSummary | null;
}

async function generateRecapNarrative(
  input: NarrativeInput,
  locale: Locale,
): Promise<string | undefined> {
  try {
    // Dynamic import to keep AI SDK out of client bundles
    const { complete } = await import('@/lib/ai/client');

    // The prompt stays English; one appended line sets the output language
    // (i18n-core §6.4), so the narrative and the headline reason taken from
    // its first sentence match the overlay's language.
    const systemPrompt = withOutputLanguage(
      'You are a sports commentator for a competitive Pokémon league. Write brief, engaging recap paragraphs.',
      locale,
    );
    const userPrompt = buildNarrativePrompt(input);
    const result = await complete(systemPrompt, userPrompt);

    return result.content ?? undefined;
  } catch {
    // AI generation is optional — fail silently
    return undefined;
  }
}

function buildNarrativePrompt(input: NarrativeInput): string {
  const matchLines = input.results
    .map((r) => `  ${r.player1_name} vs ${r.player2_name}: ${r.winner_name} wins ${r.score}`)
    .join('\n');

  return `You are a sports commentator for the "${input.leagueName}" competitive Pokémon league.

Write a brief, engaging 2-3 sentence recap paragraph for ${input.roundName} of ${input.tournamentName}. Be dramatic but concise. Reference specific results. The scores shown are Pokémon scores (surviving Pokémon).

This round's results:
${matchLines}

${input.headlineMatch ? `Headline match: ${input.headlineMatch.player1_name} vs ${input.headlineMatch.player2_name} (${input.headlineMatch.score})` : ''}

Write ONLY the paragraph — no headers, no bullet points.`;
}

function extractHeadlineReason(narrative: string, fallback: string): string {
  // Take first sentence as the headline reason
  const firstSentence = narrative.split('.')[0];
  return firstSentence ? `${firstSentence}.` : fallback;
}
