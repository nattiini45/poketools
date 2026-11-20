import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { teamUpdateSchema, formatZodErrors } from '@/lib/validation';
import { getTeamById, updateTeamPokemon, deleteTeam } from '@/lib/supabase/queries/teams';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { resolveTeamVisibility, toVisibleTeam } from '@/lib/team/visibility';
import { filterPhaseTeamVisibility } from '@/lib/team/phase-visibility';
import { toPublicTeam, type PublicTeam } from '@/lib/team/public-team';
import { toPublicPhaseTeam, type PublicPhaseTeam } from '@/lib/team/phase-public-team';
import { createPhaseTeamServices } from '@/lib/team/phase-services';
import { expireItemUsageReads } from '@/lib/team/item-usage-cache';
import { adviseKitTeam, type KitTeamAdvisory } from '@/lib/team/kit-team-gate';
import { roundOfMatch } from '@/lib/team/match-round';
import { logger } from '@/lib/logger';
import { expirePhaseReads, expirePublicTags, publicTags } from '@/lib/revalidation';
import { resolveIdOnlyTeamRoute } from '@/lib/league-phase/team-route-owner';
import type { SessionPlayer } from '@/types/auth';
import type { PhaseTeam } from '@/types/phase-team';
import { teamWriteRefusal } from '../team-write-verdict';
import type { ApiResult } from '@/types/api';
import type { PokemonSet, TeamImportSource } from '@/types/team';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/teams/[id] — get a specific team (spec §7 visibility, H3): the
 * roster is redacted unless the viewer is the owner or an admin, the team is
 * published, its tournament is `always_public`, or the row is linked to a
 * completed match. Always a `PublicTeam` (no share-link columns, C1).
 *
 * A native phase team answers as `PublicPhaseTeam` under the same redaction
 * rule (`filterPhaseTeamVisibility`, which reads the same facts).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_TEAM_ID');
    if (invalidId) return invalidId;

    const owner = await resolveIdOnlyTeamRoute(id);
    if (owner?.kind === 'phase') {
      const [visible] = await filterPhaseTeamVisibility([owner.team], {
        viewerId: player.playerId,
        isAdmin: player.isAdmin,
      });
      return NextResponse.json<ApiResult<PublicPhaseTeam>>({ success: true, data: visible });
    }

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
 * The write locks are the machine `team.roster` (`teamWriteRefusal`): a
 * manually locked team answers 409 `team_locked` for everyone; a closed
 * tournament or league answers 403 and a team linked to a completed match 409
 * `team_match_completed` for its owner; a site admin's edit is a correction
 * (the database lock lets it through). The teambuilder library save
 * (`useTeamSave`) lands here.
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

    const owner = await resolveIdOnlyTeamRoute(id);
    if (owner?.kind === 'phase') return await updateNativeTeam(owner.team, body, player);

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

    const refusal = await teamWriteRefusal(team, 'edit', player);
    if (refusal) return refusal;

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
 * DELETE /api/teams/[id] — delete a team (owner or admin; machine
 * `team.roster`, `teamWriteRefusal`). A manually locked team answers 409
 * `team_locked` and a team linked to a completed match 409
 * `team_match_completed` for its owner; a site admin may still delete either
 * (a correction). In a closed (completed or archived) tournament or league the
 * owner may still delete a team that is linked to no match; one linked to a
 * match answers 403 with the code of the closure.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_TEAM_ID');
    if (invalidId) return invalidId;

    const owner = await resolveIdOnlyTeamRoute(id);
    if (owner?.kind === 'phase') return await deleteNativeTeam(owner.team, player);

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

    // A site admin's force-delete of a locked team re-checks the live admin role first.
    if (team.locked && player.isAdmin) await requireAdmin();

    // A closed tournament or league keeps the teams that belong to a match (the match record needs them), but the
    // owner may still delete a planned team nobody played with. A site admin's delete is a correction and always passes.
    const refusal = await teamWriteRefusal(team, 'delete', player);
    if (refusal) return refusal;

    await deleteTeam(id, { correction: player.isAdmin });
    await expireItemUsageReads(team, 'api/teams/[id]');
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete team');
  }
}

/**
 * Expire the cached reads a committed write to a native phase team feeds (the
 * phase-tagged counterpart of `expireItemUsageReads`): the phase's public reads
 * always, and the item-usage aggregate scopes when the row is linked to a
 * match. Never fails the request: a failure is logged and the entries expire by
 * their TTL.
 */
async function expireNativeTeamReads(team: PhaseTeam): Promise<void> {
  try {
    const seasonId = team.season_id ?? (await getPhaseById(team.phase_id))?.season_id ?? null;
    if (seasonId) expirePhaseReads(team.phase_id, seasonId);
    if (team.match_id) {
      expirePublicTags([
        publicTags.aggregates('all_time', null),
        publicTags.aggregates('phase', team.phase_id),
        ...(seasonId ? [publicTags.aggregates('league', seasonId)] : []),
      ]);
    }
  } catch (err) {
    logger.error('api/teams/[id]', 'Phase team cache: tag expiry failed after a committed write', {
      teamId: team.id,
      phaseId: team.phase_id,
      error: err,
    });
  }
}

/**
 * PATCH of a native phase team: the phase services decide the write (owner,
 * manual lock, closed phase or league, completed match) with the same codes the
 * legacy path answers for the same cause, and the guarded UPDATE refuses a row
 * that moved on (`team_changed`). A kit advisory is not computed here: it is
 * judged by the pinned format's stage and the phase's current round, which the
 * phase paths that register a team for a match (`/api/match-prep`) own.
 */
async function updateNativeTeam(
  team: PhaseTeam,
  body: { pokemon: PokemonSet[]; import_source: TeamImportSource; name?: string },
  player: SessionPlayer
) {
  const updated = await createPhaseTeamServices().edit(
    { playerId: player.playerId, isAdmin: player.isAdmin },
    team.id,
    { pokemon: body.pokemon, import_source: body.import_source, name: body.name }
  );
  await expireNativeTeamReads(updated);
  return NextResponse.json<ApiResult<PublicPhaseTeam>>({ success: true, data: toPublicPhaseTeam(updated) });
}

/**
 * DELETE of a native phase team: the same rule as the legacy path, including
 * the live admin re-check before a force-delete of a locked team (a correction
 * the phase services let through for an admin only).
 */
async function deleteNativeTeam(team: PhaseTeam, player: SessionPlayer) {
  if (team.locked && player.isAdmin) await requireAdmin();
  await createPhaseTeamServices().delete({ playerId: player.playerId, isAdmin: player.isAdmin }, team.id);
  await expireNativeTeamReads(team);
  return NextResponse.json<ApiResult<null>>({ success: true, data: null });
}
