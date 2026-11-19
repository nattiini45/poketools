import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { BROADCAST_ROUTE_LIMITS, guardBroadcastRequest } from '@/lib/broadcast/request-guard';
import { readBroadcastMatch, readBroadcastMatchMetadata, readBroadcastHeadToHead } from '@/lib/broadcast/match-read';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { decideMatchRosterVisibility, redactedPokemon } from '@/lib/team/visibility';
import { siteSpriteUrl } from '@/lib/pkmn/sprite-styles';
import type { ApiResult } from '@/types/api';
import type {
  MatchPreviewData,
  EnrichedPlayerInfo,
  EnrichedPokemonState,
  H2HRecord,
} from '@/types/broadcast';

interface RouteContext {
  params: Promise<{ mid: string }>;
}

/**
 * GET /api/broadcast/preview/[mid]
 * Public endpoint for match preview overlay data.
 * Returns enriched player profiles + team rosters + H2H. Each roster follows
 * spec §7 for an anonymous viewer, decided against THIS match: hidden
 * (redacted) until the match is completed, unless the tournament is
 * `always_public` or the team is published to the library.
 */
// Public: no auth required
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { mid } = await context.params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(mid, 'INVALID_MATCH_ID');
    if (invalidId) return invalidId;
    const guarded = await guardBroadcastRequest(request, BROADCAST_ROUTE_LIMITS.preview);
    if (guarded) return guarded;
    const read = await readBroadcastMatch(mid);

    if (!read) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    const { match } = read;
    const p1Id = match.player_1_id;
    const p2Id = match.player_2_id;
    const readTeam = (playerId: string) => read.kind === 'phase'
      ? getPlayerPhaseTeamForMatch(playerId, read.match)
      : getPlayerTeamForMatch(playerId, read.match);

    // Fetch all data in parallel
    const [
      p1Sigs, p2Sigs,
      p1Rating, p2Rating,
      p1Streaks, p2Streaks,
      p1Achievements, p2Achievements,
      p1Team, p2Team,
      { competition, round, seasonName },
    ] = await Promise.all([
      getPlayerSignatures(p1Id),
      getPlayerSignatures(p2Id),
      getPlayerRating(p1Id),
      getPlayerRating(p2Id),
      getPlayerStreaks(p1Id),
      getPlayerStreaks(p2Id),
      getPlayerAchievements(p1Id).then((a) => a.slice(0, 5)),
      getPlayerAchievements(p2Id).then((a) => a.slice(0, 5)),
      readTeam(p1Id),
      readTeam(p2Id),
      readBroadcastMatchMetadata(read),
    ]);

    // Spec §7 per match: an upcoming match's rosters stay redacted.
    const visiblePokemon = (team: typeof p1Team) => {
      if (!team) return [];
      return decideMatchRosterVisibility(team, { viewerId: null, isAdmin: false }, match, competition?.team_visibility ?? null)
        ? team.pokemon
        : redactedPokemon();
    };

    // Compute H2H using targeted query (only fetches matches between these two players)
    const h2h = computeH2H(p1Id, p2Id, await readBroadcastHeadToHead(read));

    // Build enriched player info
    const buildPlayer = (
      id: string,
      name: string,
      avatarUrl: string | null,
      rating: Awaited<ReturnType<typeof getPlayerRating>>,
      sigs: Awaited<ReturnType<typeof getPlayerSignatures>>,
      streaks: Awaited<ReturnType<typeof getPlayerStreaks>>,
      achievements: Awaited<ReturnType<typeof getPlayerAchievements>>,
    ): EnrichedPlayerInfo => ({
      id,
      name,
      avatar_url: avatarUrl,
      record: {
        wins: rating?.wins ?? 0,
        losses: rating?.losses ?? 0,
        draws: rating?.draws ?? 0,
      },
      rating: rating
        ? { rating: rating.rating, rd: rating.rd, peak: rating.peak_rating }
        : null,
      rank: null,
      signatures: sigs?.signatures ?? [],
      streaks,
      achievements,
    });

    // Build enriched team rosters from visibility-filtered pokemon
    const enrichTeamRoster = (
      pokemon: import('@/types/team').PokemonSet[],
    ): EnrichedPokemonState[] => {
      if (pokemon.length === 0) return [];
      return pokemon.map((p) => ({
        pokemon_name: p.species,
        was_brought: false,
        was_lead: false,
        was_koed: false,
        kos_dealt: 0,
        types: [],
        sprite_url: siteSpriteUrl(p.species),
        moves_used: p.moves ?? [],
        turns_active: 0,
        is_mvp: false,
        item: p.item ?? null,
        ability: p.ability ?? null,
      }));
    };

    const preview: MatchPreviewData = {
      match_id: mid,
      player1: buildPlayer(
        p1Id, match.player_1_name, match.player_1_avatar_url,
        p1Rating, p1Sigs, p1Streaks, p1Achievements,
      ),
      player2: buildPlayer(
        p2Id, match.player_2_name, match.player_2_avatar_url,
        p2Rating, p2Sigs, p2Streaks, p2Achievements,
      ),
      player1_team: enrichTeamRoster(visiblePokemon(p1Team)),
      player2_team: enrichTeamRoster(visiblePokemon(p2Team)),
      h2h,
      tournament_name: competition?.name ?? '',
      round_name: round?.name ?? '',
      season_name: seasonName,
      format_name: '',
      best_of: round?.best_of ?? competition?.best_of_default ?? 1,
    };

    return NextResponse.json<ApiResult<MatchPreviewData>>(
      { success: true, data: preview },
      {
        headers: {
          'Cache-Control': read.sharedCache ? 'public, s-maxage=30, stale-while-revalidate=60' : 'no-store',
        },
      }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch match preview');
  }
}

function computeH2H(
  player1Id: string,
  player2Id: string,
  h2hMatches: Awaited<ReturnType<typeof readBroadcastHeadToHead>>,
): H2HRecord | null {
  if (h2hMatches.length === 0) return null;

  let p1Wins = 0;
  let p2Wins = 0;
  for (const m of h2hMatches) {
    if (m.winner_id === player1Id) p1Wins++;
    else if (m.winner_id === player2Id) p2Wins++;
  }

  return {
    player1_id: player1Id,
    player2_id: player2Id,
    player1_wins: p1Wins,
    player2_wins: p2Wins,
    total_matches: h2hMatches.length,
  };
}
