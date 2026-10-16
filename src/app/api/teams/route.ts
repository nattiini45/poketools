import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { parsePagination } from '@/lib/api/pagination';
import { teamCreateSchema, formatZodErrors } from '@/lib/validation';
import {
  listTeamsByTournament,
  listTeamsByPlayerWithContext,
  getPlayerTeamForTournament,
  createTeam,
} from '@/lib/supabase/queries/teams';
import { getTournamentById, isPlayerTournamentParticipant } from '@/lib/supabase/queries/tournaments';
import type { ApiResult } from '@/types/api';
import type { Team, TeamFormData } from '@/types/team';
import { filterTeamVisibilityBatch } from '@/lib/team/visibility';

/**
 * GET /api/teams?tournament_id=xxx  — list teams for a tournament
 * GET /api/teams?player_id=xxx     — list teams for a player (own teams)
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const { searchParams } = new URL(request.url);
    const tournamentId = searchParams.get('tournament_id');
    const playerId = searchParams.get('player_id');

    if (tournamentId) {
      const teams = await listTeamsByTournament(tournamentId);
      const filtered = await filterTeamVisibilityBatch(teams, {
        viewerId: player.playerId,
        isAdmin: player.isAdmin,
        tournamentId,
      });
      return NextResponse.json<ApiResult<Team[]>>({ success: true, data: filtered });
    }

    const { limit, offset } = parsePagination(searchParams);
    if (playerId) {
      // Players can only list their own teams (admins can list anyone's)
      if (playerId !== player.playerId && !player.isAdmin) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Cannot view other players\' teams', code: 'team_list_forbidden' },
          { status: 403 }
        );
      }
      const { data: teams, total } = await listTeamsByPlayerWithContext(playerId, { limit, offset });
      return NextResponse.json({ success: true, data: teams, total });
    }

    // Default: return the requesting player's teams
    const { data: teams, total } = await listTeamsByPlayerWithContext(player.playerId, { limit, offset });
    return NextResponse.json({ success: true, data: teams, total });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch teams');
  }
}

/**
 * POST /api/teams — create a team for a tournament
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await request.json();
    const zodResult = teamCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    if (body.tournament_id) {
      // Verify tournament exists and is not completed
      const tournament = await getTournamentById(body.tournament_id);
      if (!tournament) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
          { status: 404 }
        );
      }
      if (tournament.status === 'completed') {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Tournament is completed — team submission is closed',
            code: 'team_submission_closed',
          },
          { status: 403 }
        );
      }

      // Verify player is a tournament participant (admins can create teams on behalf of players)
      if (!player.isAdmin) {
        const isParticipant = await isPlayerTournamentParticipant(player.playerId, body.tournament_id);
        if (!isParticipant) {
          return NextResponse.json<ApiResult<never>>(
            {
              success: false,
              error: 'You are not a participant in this tournament',
              code: 'team_not_tournament_participant',
            },
            { status: 403 }
          );
        }
      }

      // Check if player already has a team for this tournament
      const existing = await getPlayerTeamForTournament(player.playerId, body.tournament_id);
      if (existing) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'You already have a team for this tournament',
            code: 'team_already_submitted',
          },
          { status: 409 }
        );
      }
    }
    // null tournament_id = personal team, no tournament checks needed

    const team = await createTeam(player.playerId, body as TeamFormData);
    return NextResponse.json<ApiResult<Team>>({ success: true, data: team }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create team');
  }
}
