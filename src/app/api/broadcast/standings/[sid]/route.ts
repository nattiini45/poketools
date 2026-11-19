import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { BROADCAST_ROUTE_LIMITS, guardBroadcastRequest } from '@/lib/broadcast/request-guard';
import { kitForPhase } from '@/lib/format-engine/context';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { loadNativeSeasonStandingsContext } from '@/lib/league-phase/standings-context';
import { getSeasonById, getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getMatchesByTournament, getMatchesByTournamentIds } from '@/lib/supabase/queries/matches';
import { getPhasesBySeasonId, getPublicPhaseStandingsParticipants } from '@/lib/supabase/queries/league-phases';
import { getPublicMatchesByPhaseIds } from '@/lib/supabase/queries/phase-matches';
import { getByeRoundsByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { assembleLeagueSchedule } from '@/lib/supabase/queries/league-standings';
import { isPlayoffStage } from '@/lib/tournament/league-placings';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getAggregates, getAggregatesSummary } from '@/lib/supabase/queries/aggregates';
import { computeStandingsForSeason, computeStandingsFromContext, loadRankingContext, type SeasonStandingsContext } from '@/lib/tournament/season-standings';
import { loadScoringByes, loadSeasonSwissByeRounds } from '@/lib/tournament/scoring-byes';
import { formatScoresByes, scoringByeRecordsForStages } from '@/lib/tournament/byes';
import { siteSpriteUrl } from '@/lib/pkmn/sprite-styles';
import type { ApiResult } from '@/types/api';
import type { SeasonLeaders } from '@/types/broadcast';
import type { MatchRecord, Standing } from '@/lib/tournament/types';

// ─── Types ───────────────────────────────────────────────────────────

interface EnrichedStandingsRow extends Standing {
  rating: number | null;
  signature_pokemon: string | null;
  signature_sprite_url: string | null;
}

interface RecentResult {
  match_id: string;
  player1_name: string;
  player2_name: string;
  winner_name: string;
  player1_avatar_url: string | null;
  player2_avatar_url: string | null;
  pokemon_score: string;
  series_score: string;
}

interface BroadcastStandings {
  season_id: string;
  league_name: string;
  standings: EnrichedStandingsRow[];
  recent_results: RecentResult[];
  leaders: SeasonLeaders;
}

// ─── Route ───────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ sid: string }>;
}

/** Public endpoint: enriched standings for broadcast overlays */
// Public: no auth required
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { sid } = await context.params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(sid, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const guarded = await guardBroadcastRequest(request, BROADCAST_ROUTE_LIMITS.standings);
    if (guarded) return guarded;

    const season = await getSeasonById(sid);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Season not found', code: 'season_not_found' },
        { status: 404 },
      );
    }

    const mode = await getPhaseRouteMode();
    const native = mode === 'phase' || mode === 'frozen_phase';
    const stages = native ? await getPhasesBySeasonId(season.id) : await getStagesBySeasonId(sid);
    if (stages.length === 0) {
      return NextResponse.json<ApiResult<BroadcastStandings>>({
        success: true,
        data: {
          season_id: sid,
          league_name: season.name,
          standings: [],
          recent_results: [],
          leaders: { season_id: sid, most_kos: null, best_record: null, pokemon_mvp: null },
        },
      }, native ? { headers: { 'Cache-Control': 'no-store' } } : undefined);
    }

    const primaryStage = stages[0];
    const hasPlayoffs = stages.some(isPlayoffStage);
    const resultStages = hasPlayoffs ? stages : [primaryStage];
    const stageIds = resultStages.map((stage) => stage.id);
    const swissIds = formatScoresByes(season.format_type)
      ? resultStages.filter((stage) => stage.bracket_type === 'swiss').map((stage) => stage.id) : [];
    const defaultRanking: SeasonStandingsContext = { formatType: season.format_type };

    const [matchesByStage, participants, ranking, groups, byeRoundsByStage] = await Promise.all([
      native ? getPublicMatchesByPhaseIds(stageIds)
        : hasPlayoffs ? getMatchesByTournamentIds(stageIds)
        : getMatchesByTournament(primaryStage.id).then((matches) => new Map([[primaryStage.id, matches]])),
      (hasPlayoffs ? getPublicSeasonParticipants(sid)
        : native ? getPublicPhaseStandingsParticipants(primaryStage.id) : getParticipants(primaryStage.id))
        .then((rows) => rows.map(({ id, name, avatar_url }) => ({ id, name, avatar_url }))),
      native ? loadNativeSeasonStandingsContext(season.id)
        : hasPlayoffs ? loadRankingContext(sid, season.format_type).then((context) => context ?? defaultRanking)
        : defaultRanking,
      hasPlayoffs ? getSeasonGroups(sid) : undefined,
      swissIds.length
        ? native ? getByeRoundsByPhaseIds(swissIds)
        : hasPlayoffs ? loadSeasonSwissByeRounds(sid) : undefined
        : undefined,
    ]);
    const completedMatches = [...matchesByStage.values()].flat().filter((m) => m.status === 'completed');

    // Build data for computeStandings
    const participantIds = participants.map((p) => p.id);
    const participantNames: Record<string, string> = {};
    const participantAvatars: Record<string, string | null> = {};
    for (const p of participants) {
      participantNames[p.id] = p.name;
      participantAvatars[p.id] = p.avatar_url ?? null;
    }

    const matchRecords: MatchRecord[] = completedMatches.map((m) => ({
      match_id: m.id,
      player_1_id: m.player_1_id,
      player_2_id: m.player_2_id,
      winner_id: m.winner_id,
      round_number: 0,
    }));

    // Format-aware: EPB seasons use the evolution-points tiebreaker chain.
    // A Swiss primary stage scores its stored byes as wins.
    let baseStandings: Standing[];
    if (hasPlayoffs) {
      const schedule = assembleLeagueSchedule({ seasonId: season.id, stages, participants, matchesByStage,
        context: ranking, groups, byeRoundsByStage });
      baseStandings = schedule.finalPlacings ?? schedule.standings;
    } else if (native) {
      baseStandings = computeStandingsFromContext(
        { ...ranking, kit: kitForPhase(ranking.kit, primaryStage.id) },
        participantIds,
        participantNames,
        matchRecords,
        participantAvatars,
        { byes: scoringByeRecordsForStages([primaryStage], byeRoundsByStage ?? new Map()) },
      );
    } else {
      baseStandings = await computeStandingsForSeason(
        sid,
        participantIds,
        participantNames,
        matchRecords,
        participantAvatars,
        // The stage rows carry no league format, so the season's is passed for the bye gate.
        { byes: await loadScoringByes({ ...primaryStage, season_format_type: season.format_type }) },
      );
    }

    // Enrich each player with rating + top signature (batch — 2 queries instead of 2N)
    const playerIds = baseStandings.map((s) => s.player_id);
    const [ratingsMap, signaturesMap] = await Promise.all([
      getPlayerRatingsBatch(playerIds),
      getPlayerSignaturesBatch(playerIds),
    ]);

    const enrichedStandings: EnrichedStandingsRow[] = baseStandings.map((s) => {
      const ratingData = ratingsMap.get(s.player_id) ?? null;
      const topSig = signaturesMap.get(s.player_id)?.[0] ?? null;

      return {
        ...s,
        rating: ratingData?.rating ?? null,
        signature_pokemon: topSig?.pokemon_name ?? null,
        signature_sprite_url: topSig ? siteSpriteUrl(topSig.pokemon_name) : null,
      };
    });

    // Recent results (last 5 completed matches)
    const recentMatches = completedMatches
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5);

    const recentResults = recentMatches.map((m) => {
      const p1Wins = m.games.filter((g) => g.winner_id === m.player_1_id).length;
      const p2Wins = m.games.filter((g) => g.winner_id === m.player_2_id).length;
      return {
        match_id: m.id,
        player1_name: m.player_1_name,
        player2_name: m.player_2_name,
        winner_name: m.winner_name ?? '',
        player1_avatar_url: m.player_1_avatar_url,
        player2_avatar_url: m.player_2_avatar_url,
        pokemon_score: `${p1Wins}-${p2Wins}`,
        series_score: `${p1Wins}-${p2Wins}`,
      };
    });

    const leaders = await computeLeaders(native ? 'phase' : 'tournament', primaryStage.id, sid, baseStandings);

    const data: BroadcastStandings = {
      season_id: sid,
      league_name: season.name,
      standings: enrichedStandings,
      recent_results: recentResults,
      leaders,
    };

    return NextResponse.json<ApiResult<BroadcastStandings>>(
      { success: true, data },
      {
        headers: {
          'Cache-Control': native ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute standings');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function computeLeaders(
  scope: 'phase' | 'tournament',
  stageId: string,
  seasonId: string,
  standings: Standing[],
): Promise<SeasonLeaders> {
  try {
    const aggregates = scope === 'phase' ? await getAggregatesSummary(scope, stageId) : await getAggregates(scope, stageId);

    // Most KOs: pokemon with highest total_kos_dealt
    let mostKos: SeasonLeaders['most_kos'] = null;
    if (aggregates.length > 0) {
      const topKO = aggregates.reduce((best, a) =>
        a.total_kos_dealt > (best?.total_kos_dealt ?? 0) ? a : best,
      );
      if (topKO && topKO.total_kos_dealt > 0) {
        mostKos = {
          player_id: '',
          player_name: '',
          pokemon_name: topKO.pokemon_name,
          kos: topKO.total_kos_dealt,
        };
      }
    }

    // Pokemon MVP: highest win rate with minimum 3 games
    let pokemonMvp: SeasonLeaders['pokemon_mvp'] = null;
    const qualified = aggregates.filter((a) => a.total_brought >= 3);
    if (qualified.length > 0) {
      const topWR = qualified.reduce((best, a) => {
        const wr = a.total_wins / a.total_brought;
        const bestWr = best ? best.total_wins / best.total_brought : 0;
        return wr > bestWr ? a : best;
      });
      if (topWR) {
        pokemonMvp = {
          pokemon_name: topWR.pokemon_name,
          appearances: topWR.total_brought,
          win_rate: Math.round((topWR.total_wins / topWR.total_brought) * 100),
        };
      }
    }

    // Best record: player with highest win rate from standings
    let bestRecord: SeasonLeaders['best_record'] = null;
    const playersWithGames = standings.filter((s) => s.wins + s.losses > 0);
    if (playersWithGames.length > 0) {
      const topPlayer = playersWithGames.reduce((best, s) => {
        const wr = s.wins / (s.wins + s.losses);
        const bestWr = best.wins / (best.wins + best.losses);
        return wr > bestWr || (wr === bestWr && s.wins > best.wins) ? s : best;
      });
      bestRecord = {
        player_id: topPlayer.player_id,
        player_name: topPlayer.player_name,
        wins: topPlayer.wins,
        losses: topPlayer.losses,
      };
    }

    return { season_id: seasonId, most_kos: mostKos, best_record: bestRecord, pokemon_mvp: pokemonMvp };
  } catch {
    return { season_id: seasonId, most_kos: null, best_record: null, pokemon_mvp: null };
  }
}
