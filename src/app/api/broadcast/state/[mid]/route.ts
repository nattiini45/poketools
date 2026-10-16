import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchById, getH2HBetweenPlayers } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getRecentMomentsByMatch } from '@/lib/supabase/queries/broadcast-moments';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { computePokemonScore } from '@/lib/match/aggregation';
import { getSpriteUrl } from '@/lib/pkmn/sprites';
import type { ApiResult } from '@/types/api';
import type {
  LiveMatchState,
  LivePokemonState,
  EnrichedMatchState,
  EnrichedPlayerInfo,
  EnrichedPokemonState,
  GameBreakdown,
  H2HRecord,
} from '@/types/broadcast';
import type { BattleStat } from '@/types/game';

interface RouteContext {
  params: Promise<{ mid: string }>;
}

/**
 * GET /api/broadcast/state/[mid]
 * Public endpoint polled by OBS overlays. Returns current match state.
 * No auth required — overlay data is public.
 *
 * Query params:
 * - enrich=true: Returns EnrichedMatchState with full player profiles,
 *   team data, pokemon scores, signatures, ratings, achievements, etc.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { mid } = await context.params;
    const enrich = request.nextUrl.searchParams.get('enrich') === 'true';
    const match = await getMatchById(mid);

    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    // Get all battle stats for this match
    const [statsByGame, recentMoments] = await Promise.all([
      getBattleStatsByMatch(mid),
      getRecentMomentsByMatch(mid, 5),
    ]);

    // Series score from completed games
    const p1Wins = match.games.filter((g) => g.winner_id === match.player_1_id).length;
    const p2Wins = match.games.filter((g) => g.winner_id === match.player_2_id).length;

    // Current game (latest game's stats, if any game exists)
    const latestGame = match.games.length > 0
      ? match.games[match.games.length - 1]
      : null;

    let currentGame: LiveMatchState['current_game'] = null;
    if (latestGame) {
      const gameStats = statsByGame[latestGame.id] ?? [];

      const buildPokemonStates = (playerId: string): LivePokemonState[] =>
        gameStats
          .filter((s) => s.player_id === playerId)
          .map((s) => ({
            pokemon_name: s.pokemon_name,
            was_brought: s.was_brought,
            was_lead: s.was_lead,
            was_koed: s.was_koed,
            kos_dealt: s.kos_dealt,
          }));

      currentGame = {
        game_number: latestGame.game_number,
        player1_kos: gameStats
          .filter((s) => s.player_id === match.player_1_id)
          .reduce((sum, s) => sum + s.kos_dealt, 0),
        player2_kos: gameStats
          .filter((s) => s.player_id === match.player_2_id)
          .reduce((sum, s) => sum + s.kos_dealt, 0),
        player1_pokemon: buildPokemonStates(match.player_1_id),
        player2_pokemon: buildPokemonStates(match.player_2_id),
      };
    }

    const baseState: LiveMatchState = {
      match_id: mid,
      series_score: { player1: p1Wins, player2: p2Wins },
      player1: {
        id: match.player_1_id,
        name: match.player_1_name,
        avatar_url: match.player_1_avatar_url,
      },
      player2: {
        id: match.player_2_id,
        name: match.player_2_name,
        avatar_url: match.player_2_avatar_url,
      },
      current_game: currentGame,
      recent_moments: recentMoments,
      match_status: match.status,
      winner_id: match.winner_id,
    };

    // If enrich=true, add full player profiles, team data, and analytics
    if (enrich) {
      const enrichedState = await buildEnrichedState(
        baseState,
        match,
        statsByGame,
      );

      return NextResponse.json<ApiResult<EnrichedMatchState>>(
        { success: true, data: enrichedState },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
          },
        }
      );
    }

    // Slim response for backward compatibility
    return NextResponse.json<ApiResult<LiveMatchState>>(
      { success: true, data: baseState },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=5',
        },
      }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch broadcast state');
  }
}

// ─── Enrichment ─────────────────────────────────────────────────────

async function buildEnrichedState(
  baseState: LiveMatchState,
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
  statsByGame: Record<string, BattleStat[]>,
): Promise<EnrichedMatchState> {
  const p1Id = baseState.player1.id;
  const p2Id = baseState.player2.id;
  const m = match;

  // Fetch all enrichment data in parallel
  const [
    p1Sigs, p2Sigs,
    p1Rating, p2Rating,
    p1Streaks, p2Streaks,
    p1Achievements, p2Achievements,
    tournament,
    round,
    h2hMatches,
  ] = await Promise.all([
    getPlayerSignatures(p1Id),
    getPlayerSignatures(p2Id),
    getPlayerRating(p1Id),
    getPlayerRating(p2Id),
    getPlayerStreaks(p1Id),
    getPlayerStreaks(p2Id),
    getPlayerAchievements(p1Id).then((a) => a.slice(0, 5)),
    getPlayerAchievements(p2Id).then((a) => a.slice(0, 5)),
    getTournamentById(m.tournament_id),
    getRoundById(m.round_id),
    getH2HBetweenPlayers(p1Id, p2Id, m.tournament_id).catch(() => []),
  ]);

  // Compute H2H record and timeline from the single targeted query
  const h2h = computeH2HFromMatches(h2hMatches, p1Id, p2Id);
  const h2hTimeline = buildH2HTimelineFromMatches(h2hMatches, p1Id, p2Id, m.id);

  // Get season name if tournament has a season
  let seasonName = '';
  if (tournament?.season_id) {
    const season = await getSeasonById(tournament.season_id);
    seasonName = season?.name ?? '';
  }

  // Fetch match analysis if available
  const analysis = await getMatchAnalysis(m.id);

  // Compute pokemon score
  const pokemonScore = computePokemonScore(statsByGame, p1Id, p2Id);

  // Build per-game breakdowns
  const perGameBreakdown = buildGameBreakdowns(m, statsByGame);

  // Build enriched player info
  const buildPlayer = (
    base: LiveMatchState['player1'],
    rating: Awaited<ReturnType<typeof getPlayerRating>>,
    sigs: Awaited<ReturnType<typeof getPlayerSignatures>>,
    streaks: Awaited<ReturnType<typeof getPlayerStreaks>>,
    achievements: Awaited<ReturnType<typeof getPlayerAchievements>>,
  ): EnrichedPlayerInfo => ({
    id: base.id,
    name: base.name,
    avatar_url: base.avatar_url,
    record: {
      wins: rating?.wins ?? 0,
      losses: rating?.losses ?? 0,
      draws: rating?.draws ?? 0,
    },
    rating: rating
      ? { rating: rating.rating, rd: rating.rd, peak: rating.peak_rating }
      : null,
    rank: null, // Would need standings computation — populated in preview endpoint
    signatures: sigs?.signatures ?? [],
    streaks,
    achievements,
  });

  return {
    ...baseState,
    enriched_player1: buildPlayer(baseState.player1, p1Rating, p1Sigs, p1Streaks, p1Achievements),
    enriched_player2: buildPlayer(baseState.player2, p2Rating, p2Sigs, p2Streaks, p2Achievements),
    pokemon_score: { p1: pokemonScore.p1Score, p2: pokemonScore.p2Score },
    per_game_breakdown: perGameBreakdown,
    tournament_name: tournament?.name ?? '',
    round_name: round?.name ?? '',
    season_name: seasonName,
    format_name: '',
    h2h,
    h2h_matches: h2hTimeline,
    match_analysis: analysis,
  };
}

// ─── Game Breakdowns ────────────────────────────────────────────────

function buildGameBreakdowns(
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>,
  statsByGame: Record<string, BattleStat[]>,
): GameBreakdown[] {
  return match.games.map((game) => {
    const gameStats = statsByGame[game.id] ?? [];
    const p1Id = match.player_1_id;
    const p2Id = match.player_2_id;

    const p1Stats = gameStats.filter((s) => s.player_id === p1Id);
    const p2Stats = gameStats.filter((s) => s.player_id === p2Id);

    const isP1Winner = game.winner_id === p1Id;

    return {
      game_number: game.game_number,
      winner_id: game.winner_id,
      player1_pokemon: enrichPokemonStates(p1Stats, isP1Winner),
      player2_pokemon: enrichPokemonStates(p2Stats, !isP1Winner),
      player1_kos: p1Stats.reduce((sum, s) => sum + s.kos_dealt, 0),
      player2_kos: p2Stats.reduce((sum, s) => sum + s.kos_dealt, 0),
      player1_alive: p1Stats.filter((s) => s.was_brought && !s.was_koed).length,
      player2_alive: p2Stats.filter((s) => s.was_brought && !s.was_koed).length,
      moments: [],
      replay_url: game.replay_url || null,
    };
  });
}

function enrichPokemonStates(stats: BattleStat[], isWinner: boolean): EnrichedPokemonState[] {
  // Find MVP (highest KOs among brought pokemon on winning side)
  const brought = stats.filter((s) => s.was_brought);
  const mvpStat = isWinner && brought.length > 0
    ? brought.reduce((best, curr) => curr.kos_dealt > best.kos_dealt ? curr : best)
    : null;

  return stats.map((s) => ({
    pokemon_name: s.pokemon_name,
    was_brought: s.was_brought,
    was_lead: s.was_lead,
    was_koed: s.was_koed,
    kos_dealt: s.kos_dealt,
    types: [],
    sprite_url: getSpriteUrl(s.pokemon_name),
    moves_used: s.moves_used,
    turns_active: s.turns_active,
    is_mvp: mvpStat?.pokemon_name === s.pokemon_name && s.kos_dealt > 0,
    item: null,
    ability: null,
  }));
}

// ─── H2H Computation (pure functions — operate on pre-fetched matches) ──

function computeH2HFromMatches(
  matches: Awaited<ReturnType<typeof getH2HBetweenPlayers>>,
  player1Id: string,
  player2Id: string,
): H2HRecord | null {
  if (matches.length === 0) return null;

  let p1Wins = 0;
  let p2Wins = 0;
  for (const m of matches) {
    if (m.winner_id === player1Id) p1Wins++;
    else if (m.winner_id === player2Id) p2Wins++;
  }

  return {
    player1_id: player1Id,
    player2_id: player2Id,
    player1_wins: p1Wins,
    player2_wins: p2Wins,
    total_matches: matches.length,
  };
}

/** One past H2H encounter on the timeline. */
interface H2HTimelineEntry {
  match_id: string;
  date: string;
  /** The winner's name, or the English label `'Draw'` (kept for older overlays). */
  winner_name: string;
  /** True when the match has no winner: overlays translate it instead of showing `winner_name` (i18n-core §6.5). */
  draw: boolean;
  score: string;
}

/** Build a timeline of past H2H encounters (excluding current match) */
function buildH2HTimelineFromMatches(
  matches: Awaited<ReturnType<typeof getH2HBetweenPlayers>>,
  player1Id: string,
  player2Id: string,
  currentMatchId: string,
): H2HTimelineEntry[] {
  return matches
    .filter((m) => m.id !== currentMatchId)
    .sort((a, b) => new Date(b.date_played ?? b.updated_at).getTime() - new Date(a.date_played ?? a.updated_at).getTime())
    .map((m) => {
      const p1Wins = m.games.filter((g) => g.winner_id === m.player_1_id).length;
      const p2Wins = m.games.filter((g) => g.winner_id === m.player_2_id).length;
      return {
        match_id: m.id,
        date: m.date_played ?? m.updated_at,
        // i18n-ignore: compatibility label for overlays that predate `draw`; new overlays translate `draw`.
        winner_name: m.winner_name ?? 'Draw',
        draw: m.winner_name == null,
        score: `${p1Wins}-${p2Wins}`,
      };
    });
}
