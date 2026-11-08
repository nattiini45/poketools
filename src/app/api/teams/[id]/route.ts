import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { teamUpdateSchema, formatZodErrors } from '@/lib/validation';
import { getTeamById, getTeamVisibilityFacts, updateTeamPokemon, deleteTeam } from '@/lib/supabase/queries/teams';
import { isCompletedMatchLocked } from '@/lib/team/completed-match-lock';
import { resolveTeamVisibility, toVisibleTeam } from '@/lib/team/visibility';
import { toPublicTeam, type PublicTeam } from '@/lib/team/public-team';
import { expireItemUsageReads } from '@/lib/team/item-usage-cache';
import { adviseKitTeam, type KitTeamAdvisory } from '@/lib/team/kit-team-gate';
import { roundOfMatch } from '@/lib/team/match-round';
import { logger } from '@/lib/logger';
import { teamWritesClosed } from '../team-writes-closed';
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

function teamSubmissionClosedResponse(): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: 'Tournament is completed — team submission is closed', code: 'team_submission_closed' },
    { status: 403 }
  );
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

    // A completed or archived tournament or league takes no more team edits from its players.
    if (!player.isAdmin && team.tournament_id && (await teamWritesClosed(team.tournament_id))) {
      return teamSubmissionClosedResponse();
    }

    if (!player.isAdmin && (await linkedToCompletedMatch(team))) {
      return completedMatchResponse();
    }

    // A kit league's stage constraints and the owner's resources: advice, never a refusal. The verdict reads the OWNER's
    // gifts and pools (own-visibility resources whose giver is hidden), so only the owner gets it: a site admin
    // editing another player's team would otherwise probe their holdings through `team_check`, as `validate-team`
    // already withholds. An admin's rewrite of a match-linked roster is a correction (it may be a completed match's)
    // and gets no advisory either, as the rules have moved on since.
    let advisory: KitTeamAdvisory = {};
    if (team.tournament_id && team.player_id === player.playerId && !(player.isAdmin && team.match_id)) {
      const context = { tournamentId: team.tournament_id, playerId: team.player_id };
      try {
        // A team registered for a match is judged by the rules of that match's round; a planned team by the phase's
        // current round. A match that cannot be read is no reason to refuse the save, and no reason to judge the team
        // by another round: the advisory is reported unavailable.
        const matchRound = team.match_id ? await roundOfMatch(team.match_id, team.tournament_id) : null;
        const roundNumber = matchRound?.status === 'ok' ? matchRound.roundNumber : undefined;
        if (matchRound && roundNumber === undefined) {
          // The match (or its round) is gone or belongs to another tournament: never fall back to the phase's round.
          logger.warn('api/team-check', 'Match round not found for the team advisory', { ...context, teamId: team.id });
          advisory = { team_check: { status: 'unavailable' } };
        } else {
          advisory = await adviseKitTeam(
            { tournament: team.tournament_id, playerId: team.player_id, pokemon: body.pokemon, ...(roundNumber !== undefined ? { roundNumber } : {}) },
            context
          );
        }
      } catch (roundError) {
        logger.error('api/team-check', 'Match round could not be read for the team advisory', { ...context, teamId: team.id, error: roundError });
        advisory = { team_check: { status: 'unavailable' } };
      }
    }

    // The database refuses a completed match's roster for any non-correction
    // write (a completion racing this request answers the same 409).
    const updated = await updateTeamPokemon(id, body.pokemon, body.import_source, body.name, {
      correction: player.isAdmin,
    });
    await expireItemUsageReads(updated, 'api/teams/[id]');
    return NextResponse.json<ApiResult<PublicTeam>>({ success: true, data: toPublicTeam(updated), ...advisory });
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

    // A completed or archived tournament or league takes no more team edits from its players.
    if (!player.isAdmin && team.tournament_id && (await teamWritesClosed(team.tournament_id))) {
      return teamSubmissionClosedResponse();
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
