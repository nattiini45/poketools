import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { castSessionPopulateSchema, formatZodErrors } from '@/lib/validation';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { resolveActualTeam } from '@/lib/match/aggregation';
import { canViewTeamPokemon } from '@/lib/team/visibility';
import type { ApiResult } from '@/types/api';
import type { CastSessionPopulateResult } from '@/types/cast-session';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/cast-sessions/[id]/populate
 * Auto-fill a cast session from match data. Loads match info, player names,
 * teams (if committed), game count. Returns everything for the client to merge.
 *
 * Body: { match_id: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requireCreator();
    const { id } = await params;

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
    // falling back to planned tournament teams if no games have been played yet.
    const [team1, team2, battleStatsByGame] = await Promise.all([
      match.tournament_id
        ? getPlayerTeamForTournament(match.player_1_id, match.tournament_id).catch(() => null)
        : null,
      match.tournament_id
        ? getPlayerTeamForTournament(match.player_2_id, match.tournament_id).catch(() => null)
        : null,
      getBattleStatsByMatch(match.id).catch(() => ({} as Record<string, never>)),
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

    // Apply team visibility — creators populating their own cast session
    // get full visibility (requireCreator + session ownership already verified)
    const visCtx = {
      viewerId: player.playerId,
      isAdmin: true,
      tournamentId: match.tournament_id,
    };
    const p1Visible = team1 ? await canViewTeamPokemon(team1, visCtx) : false;
    const p2Visible = team2 ? await canViewTeamPokemon(team2, visCtx) : false;

    // Resolve format from tournament's ruleset
    let format: string | null = null;
    let generation: number | null = null;
    if (tournament?.ruleset_id) {
      const ruleset = await getRulesetById(tournament.ruleset_id);
      if (ruleset) {
        format = ruleset.base_format;
        // Extract generation number from format string (e.g., 'gen9ou' → 9)
        const genMatch = ruleset.base_format.match(/^gen(\d)/);
        generation = genMatch ? parseInt(genMatch[1], 10) : null;
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
