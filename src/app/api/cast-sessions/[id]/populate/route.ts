import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { castSessionPopulateSchema, formatZodErrors } from '@/lib/validation';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { resolveActualTeam } from '@/lib/match/aggregation';
import { decideMatchRosterVisibility, type TeamViewer } from '@/lib/team/visibility';
import { generationOf } from '@/lib/pkmn/format-id';
import type { ApiResult } from '@/types/api';
import type { CastSessionPopulateResult } from '@/types/cast-session';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/cast-sessions/[id]/populate
 * Auto-fill a cast session from match data. Loads match info, player names,
 * teams (if committed), game count. Returns everything for the client to merge.
 * Rosters follow spec §7 for the calling player, decided against this match:
 * a creator sees them once the match is completed (or the tournament is
 * `always_public`); only an admin sees them before.
 *
 * Body: { match_id: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SESSION_ID');
    if (invalidId) return invalidId;

    // Verify session ownership
    const session = await getCastSessionById(id);
    if (!session) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Session not found', code: 'cast_session_not_found' },
        { status: 404 }
      );
    }
    if (session.owner_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized', code: 'cast_session_forbidden' },
        { status: 403 }
      );
    }

    const rawBody = await request.json();
    const zodResult = castSessionPopulateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // Load match with player names
    const match = await getMatchById(zodResult.data.match_id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    // Load round (for best_of and name) and tournament (for format) in parallel
    const [round, tournament] = await Promise.all([
      getRoundById(match.round_id),
      getTournamentById(match.tournament_id),
    ]);

    // Try to load actual teams from battle_stats first (confirmed game data),
    // falling back to each player's team for this match if no games have been
    // played yet. A failed team or battle-stats read fails the request (logged
    // by safeErrorResponse): an empty roster would silently stand in for a
    // read error.
    const [team1, team2, battleStatsByGame] = await Promise.all([
      getPlayerTeamForMatch(match.player_1_id, match),
      getPlayerTeamForMatch(match.player_2_id, match),
      getBattleStatsByMatch(match.id),
    ]);

    // Resolve actual teams: prefer battle_stats species, enriched with planned
    // team details. Falls back to planned team when no games exist yet.
    const hasGameStats = Object.keys(battleStatsByGame).length > 0;
    const p1ActualTeam = hasGameStats
      ? resolveActualTeam(battleStatsByGame, match.player_1_id, team1?.pokemon ?? [])
      : null;
    const p2ActualTeam = hasGameStats
      ? resolveActualTeam(battleStatsByGame, match.player_2_id, team2?.pokemon ?? [])
      : null;

    // Spec §7 per match with the caller's real role: owning the cast session
    // grants no roster access (creators are not admins).
    const viewer: TeamViewer = { viewerId: player.playerId, isAdmin: player.isAdmin };
    const tournamentVisibility = tournament?.team_visibility ?? null;
    const p1Visible = team1
      ? decideMatchRosterVisibility(team1, viewer, match, tournamentVisibility)
      : false;
    const p2Visible = team2
      ? decideMatchRosterVisibility(team2, viewer, match, tournamentVisibility)
      : false;

    // Resolve format from tournament's ruleset
    let format: string | null = null;
    let generation: number | null = null;
    if (tournament?.ruleset_id) {
      const ruleset = await getRulesetById(tournament.ruleset_id);
      if (ruleset) {
        format = ruleset.base_format;
        // Extract generation number from format string (e.g., 'gen9ou' → 9)
        generation = generationOf(ruleset.base_format);
      }
    }

    const result: CastSessionPopulateResult = {
      match: {
        id: match.id,
        tournament_id: match.tournament_id,
        season_id: tournament?.season_id ?? null,
        round_name: round?.name ?? null,
        best_of: round?.best_of ?? 3,
        status: match.status,
      },
      player1: {
        id: match.player_1_id,
        name: match.player_1_name,
        avatar_url: match.player_1_avatar_url ?? null,
      },
      player2: {
        id: match.player_2_id,
        name: match.player_2_name,
        avatar_url: match.player_2_avatar_url ?? null,
      },
      player1_team: p1Visible ? (p1ActualTeam ?? team1?.pokemon ?? []) : [],
      player2_team: p2Visible ? (p2ActualTeam ?? team2?.pokemon ?? []) : [],
      games: match.games,
      games_played: match.games.length,
      format,
      generation,
    };

    return NextResponse.json<ApiResult<CastSessionPopulateResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to populate cast session');
  }
}
