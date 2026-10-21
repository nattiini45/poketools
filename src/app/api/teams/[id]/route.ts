import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { teamUpdateSchema, formatZodErrors } from '@/lib/validation';
import { getTeamById, getTeamVisibilityFacts, updateTeamPokemon, deleteTeam } from '@/lib/supabase/queries/teams';
import { isCompletedMatchLocked } from '@/lib/team/completed-match-lock';
import { resolveTeamVisibility, toVisibleTeam } from '@/lib/team/visibility';
import { toPublicTeam, type PublicTeam } from '@/lib/team/public-team';
import { expireItemUsageReads } from '@/lib/team/item-usage-cache';
import type { ApiResult } from '@/types/api';
import type { PokemonSet, Team, TeamImportSource } from '@/types/team';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Whether the row is linked to a COMPLETED match (lead ruling round 5): its
 * roster is public and final, so only a site admin may still change or
 * delete it. A row with no match link needs no read.
 */
async function linkedToCompletedMatch(team: Team): Promise<boolean> {
  if (!team.match_id) return false;
  const facts = await getTeamVisibilityFacts([team.id]);
  return isCompletedMatchLocked(facts.get(team.id)?.match_status);
}

function completedMatchResponse(): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: 'This team belongs to a completed match and can no longer be changed',
      code: 'team_match_completed',
    },
    { status: 409 }
  );
}

/**
 * GET /api/teams/[id] — get a specific team (spec §7 visibility, H3): the
 * roster is redacted unless the viewer is the owner or an admin, the team is
 * published, its tournament is `always_public`, or the row is linked to a
 * completed match. Always a `PublicTeam` (no share-link columns, C1).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_TEAM_ID');
    if (invalidId) return invalidId;
    const team = await getTeamById(id);

    if (!team) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Team not found', code: 'team_not_found' },
        { status: 404 }
      );
    }

    const [visible] = await resolveTeamVisibility([team], {
      viewerId: player.playerId,
      isAdmin: player.isAdmin,
    });
    return NextResponse.json<ApiResult<PublicTeam>>({ success: true, data: toVisibleTeam(team, visible) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch team');
  }
}

/**
 * PATCH /api/teams/[id] — update team pokemon (only owner, only if unlocked).
 * A team linked to a completed match answers 409 `team_match_completed` for
 * its owner; a site admin's edit is a correction (the database lock lets it
 * through). The teambuilder library save (`useTeamSave`) lands here.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_TEAM_ID');
    if (invalidId) return invalidId;
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

    if (!player.isAdmin && (await linkedToCompletedMatch(team))) {
      return completedMatchResponse();
    }

    // The database refuses a completed match's roster for any non-correction
    // write (a completion racing this request answers the same 409).
    const updated = await updateTeamPokemon(id, body.pokemon, body.import_source, body.name, {
      correction: player.isAdmin,
    });
    await expireItemUsageReads(updated, 'api/teams/[id]');
    return NextResponse.json<ApiResult<PublicTeam>>({ success: true, data: toPublicTeam(updated) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update team');
  }
}

/**
 * DELETE /api/teams/[id] — delete a team (owner or admin, only if unlocked).
 * A team linked to a completed match answers 409 `team_match_completed` for
 * its owner; a site admin may still delete it (a correction).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_TEAM_ID');
    if (invalidId) return invalidId;

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

    if (!player.isAdmin && (await linkedToCompletedMatch(team))) {
      return completedMatchResponse();
    }

    await deleteTeam(id, { correction: player.isAdmin });
    await expireItemUsageReads(team, 'api/teams/[id]');
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete team');
  }
}
