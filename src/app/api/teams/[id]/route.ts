import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { teamUpdateSchema, formatZodErrors } from '@/lib/validation';
import { getTeamById, updateTeamPokemon, deleteTeam } from '@/lib/supabase/queries/teams';
import { canViewTeamPokemon, filterTeamVisibility } from '@/lib/team/visibility';
import type { ApiResult } from '@/types/api';
import type { Team, PokemonSet, TeamImportSource } from '@/types/team';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/teams/[id] — get a specific team (with visibility enforcement)
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const team = await getTeamById(id);

    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }

    // Enforce visibility (spec Section 7)
    const ctx = { viewerId: player.playerId, isAdmin: player.isAdmin };
    const visible = await canViewTeamPokemon(team, ctx);
    if (!visible) {
      const [redacted] = await filterTeamVisibility([team], ctx);
      return NextResponse.json<ApiResult<Team>>({ success: true, data: redacted });
    }

    return NextResponse.json<ApiResult<Team>>({ success: true, data: team });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch team');
  }
}

/**
 * PATCH /api/teams/[id] — update team pokemon (only owner, only if unlocked)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const rawBody = await request.json();
    const zodResult = teamUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data as {
      pokemon: PokemonSet[];
      import_source: TeamImportSource;
      name?: string;
    };

    const team = await getTeamById(id);
    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }

    // Only the owner can edit their team
    if (team.player_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not your team', code: 'team_not_owner' },
        { status: 403 }
      );
    }

    if (team.locked) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team is locked', code: 'team_locked' },
        { status: 409 }
      );
    }

    const updated = await updateTeamPokemon(id, body.pokemon, body.import_source, body.name);
    return NextResponse.json<ApiResult<Team>>({ success: true, data: updated });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update team');
  }
}

/**
 * DELETE /api/teams/[id] — delete a team (owner or admin, only if unlocked)
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    const team = await getTeamById(id);
    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }

    if (team.player_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not your team', code: 'team_not_owner' },
        { status: 403 }
      );
    }

    if (team.locked) {
      // Admins can force-delete locked teams
      if (!player.isAdmin) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Team is locked', code: 'team_locked' },
          { status: 409 }
        );
      }
      // For admin deletion of locked teams, bypass the lock check
      await requireAdmin();
    }

    await deleteTeam(id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete team');
  }
}
