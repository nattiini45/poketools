import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getAggregates } from '@/lib/supabase/queries/aggregates';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
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
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { sid } = await context.params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(sid, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const season = await getSeasonById(sid);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Season not found', code: 'season_not_found' },
        { status: 404 },
      );
    }

    // Get all tournaments in this season
    const tournaments = await getStagesBySeasonId(sid);
    if (tournaments.length === 0) {
      return NextResponse.json<ApiResult<BroadcastStandings>>({
        success: true,
        data: {
          season_id: sid,
          league_name: season.name,
          standings: [],
          recent_results: [],
          leaders: { season_id: sid, most_kos: null, best_record: null, pokemon_mvp: null },
        },
      });
    }

    // Use the first (primary) tournament for standings
    const primaryTournament = tournaments[0];

    // Fetch matches and participants in parallel (redact PII from participants)
    const [allMatches, rawParticipants] = await Promise.all([
      getMatchesByTournament(primaryTournament.id),
      getParticipants(primaryTournament.id),
    ]);
    const participants = rawParticipants.map(({ discord_id: _, auth_user_id: __, ...rest }) => rest);

    const completedMatches = allMatches.filter((m) => m.status === 'completed');

    // Build data for computeStandings
    const participantIds = participants.map((p) => p.id);
    const participantNames: Record<string, string> = {};
    const participantAvatars: Record<string, string | null> = {};
    for (const p of participants) {
      participantNames[p.id] = p.name;
      participantAvatars[p.id] = p.avatar_url ?? null;
    }

    const matchRecords: MatchRecord[] = completedMatches.map((m) => ({
      player_1_id: m.player_1_id,
      player_2_id: m.player_2_id,
      winner_id: m.winner_id,
      round_number: 0,
    }));

    // Format-aware: EPB seasons use the evolution-points tiebreaker chain
    const baseStandings = await computeStandingsForSeason(
      sid,
      participantIds,
      participantNames,
      matchRecords,
      participantAvatars,
    );

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

    // Compute leaders from tournament aggregates
    const leaders = await computeLeaders(primaryTournament.id, sid, baseStandings);

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
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute standings');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function computeLeaders(
  tournamentId: string,
  seasonId: string,
  standings: Standing[],
): Promise<SeasonLeaders> {
  try {
    const aggregates = await getAggregates('tournament', tournamentId);

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
