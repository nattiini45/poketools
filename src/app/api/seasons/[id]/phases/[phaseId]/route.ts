import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import {
  phaseUpdateSchema,
  phaseDeleteSchema,
  formatZodErrors,
} from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent, diffField } from '@/lib/audit/log';
import { legacyPhasePersistence, nativePhasePersistence } from '@/lib/league-phase/lifecycle-persistence';
import { updateAdminPhase } from '@/lib/league-phase/admin-transition';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { deleteAdminPhase, getPhaseWithDetails } from '@/lib/supabase/queries/league-phases';
import { createMixedEntityDeleteRebuilder } from '@/lib/league-phase/entity-rebuild';
import { listRoundStatusesByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import { newEvenBestOfIssues } from '@/lib/tournament/best-of';
import { buildLeaguePhase, assertPhaseEditable, assertPhaseNameFree } from '@/lib/tournament/league-phase';
import {
  rebuildAfterTournamentDelete,
  type EntityDeleteRebuildSummary,
} from '@/lib/reconcile/entity-delete-rebuild';
import { expirePhaseReads, expireRatingReads, expireTournamentReads } from '@/lib/revalidation';
import { readJsonBody } from '@/lib/api/json-body';
import {
  toDeleteRebuildWarning,
  type DeleteRebuildWarning,
  type EntityDeleteResult,
} from '@/lib/api/delete-rebuild-warning';
import { assertRulesetChangeAllowed } from '@/lib/ruleset-studio/pin-change';
import {
  assertFormatPhaseDeletable,
  assertFormatPhaseStatusUnchanged,
  assertFormatPhaseUnchanged,
} from '@/lib/format-studio/phase-guards';
import type { ApiResult } from '@/types/api';
import type { LeaguePhase } from '@/types/season';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { statusEffectsAuditMetadata, updateTournamentWithStatus } from '@/lib/tournament/tournament-transition';

const { getById: getTournamentById, getWithDetails: getTournamentWithDetails, listBySeason: getStagesBySeasonId, remove: deleteTournament, participants: getParticipants, rounds: getRoundsByTournament } = legacyPhasePersistence;
const nativePhaseUpdateSchema = phaseUpdateSchema.extend({ archived: z.boolean().optional() });

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

export const maxDuration = 300;

// Public: no auth required — phase (league stage) detail
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const mode = await requireOpenPhaseRouteMode();
    const phase = mode === 'phase' ? await getPhaseWithDetails(phaseId) : await getTournamentWithDetails(phaseId);
    if (!phase || phase.season_id !== id.toLowerCase()) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rounds = mode === 'phase' ? await listRoundStatusesByPhaseIds([phase.id]) : await getRoundsByTournament(phaseId);
    return NextResponse.json<ApiResult<LeaguePhase>>({
      success: true,
      data: buildLeaguePhase(phase, rounds),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch phase');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;

    const native = (await requireOpenPhaseRouteMode()) === 'phase';
    const nativeBefore = native ? await getPhaseWithDetails(phaseId, id) : null;
    const legacyBefore = native ? null : await getTournamentById(phaseId);
    const before = nativeBefore ?? legacyBefore;
    if (!before || before.season_id !== id.toLowerCase()) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    const parsed = (native ? nativePhaseUpdateSchema : phaseUpdateSchema).safeParse(json.value);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body: z.infer<typeof nativePhaseUpdateSchema> = parsed.data;
    const seasonId = before.season_id;
    if (nativeBefore && body.archived !== undefined && Object.keys(body).length !== 1) {
      throw new UserFacingError('Archive or restore the phase separately from other edits.', {
        code: 'phase_archive_edit_separately', status: 400,
      });
    }
    if (nativeBefore?.archived && body.archived === undefined) {
      throw new UserFacingError('Archived phase is read-only', { code: 'phase_bracket_archived', status: 409 });
    }

    // The schema takes a legacy even best-of so the form can send the stored record back;
    // only an even value the phase does not already hold is refused.
    const evenIssues = newEvenBestOfIssues(body, before);
    if (evenIssues.length > 0) {
      const issues = evenIssues.join('; ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    if (body.bracket_type !== undefined && body.bracket_type !== before.bracket_type) {
      assertPhaseEditable(before, 'bracket_type');
    }

    // A phase the league's attached format created keeps its structure and moves its status through the tournament route,
    // which runs the format's reaction (409 format_phase_owned).
    if (nativeBefore) {
      const formatManaged = nativeBefore.format_stage_key !== null;
      await assertFormatPhaseUnchanged(seasonId, before, body, formatManaged);
      await assertFormatPhaseStatusUnchanged(seasonId, before, body.status, formatManaged);
    } else {
      await assertFormatPhaseUnchanged(seasonId, before, body);
      await assertFormatPhaseStatusUnchanged(seasonId, before, body.status);
    }

    if (before.status === 'completed' && body.status !== 'active') {
      const lockedFields = ['name', 'bracket_type', 'ruleset_id', 'best_of_default', 'bo_overrides', 'is_doubles', 'team_visibility', 'advancement_rule'] as const;
      for (const field of lockedFields) {
        if (body[field] !== undefined) {
          throw new UserFacingError(
            'Completed phases are locked. Reopen to active first.',
            { code: 'PHASE_COMPLETED_LOCKED', status: 400 }
          );
        }
      }
    }

    // The phase's ruleset is a pin to an immutable version: a new value must be a ruleset the caller may use, and once the
    // phase has started it moves only through the pin route. Resending the stored value passes.
    await assertRulesetChangeAllowed({
      player: admin,
      current: before.ruleset_id,
      requested: body.ruleset_id,
      started: before.status !== 'upcoming',
    });

    // A rename may not take another phase's name. Saving the unchanged name
    // passes, so a league that already holds duplicates stays editable.
    if (body.name !== undefined && body.name.toLowerCase() !== before.name.trim().toLowerCase()) {
      const phases = await (native ? nativePhasePersistence.listBySeason(seasonId) : getStagesBySeasonId(seasonId));
      assertPhaseNameFree(body.name, phases, before.id);
    }

    const outcome = legacyBefore
      ? await updateTournamentWithStatus(legacyBefore, body, { actor: 'admin' })
      : await updateAdminPhase(nativeBefore!, body);
    const phase = 'phase' in outcome ? outcome.phase : outcome.tournament;
    const { formatReactionFailed, autoAdvanceHeld, autoAdvanceRepeated } = outcome;
    const statusEffects = statusEffectsAuditMetadata(outcome);
    if (!native) expireTournamentReads(phase.id, seasonId);

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    diffField(changes, 'name', before.name, phase.name);
    diffField(changes, 'status', before.status, phase.status);
    diffField(changes, 'bracket_type', before.bracket_type, phase.bracket_type);
    if (native) diffField(changes, 'archived', before.archived, phase.archived);
    if (Object.keys(changes).length > 0 || autoAdvanceRepeated || autoAdvanceHeld) {
      logAuditEvent({
        action: 'phase.update',
        actor_id: admin.playerId,
        actor_name: admin.name,
        resource_type: native ? 'phase' : 'tournament',
        resource_id: phase.id,
        resource_name: phase.name,
        changes,
        ...(Object.keys(statusEffects).length > 0 ? { metadata: statusEffects } : {}),
      });
    }

    const withDetails = native ? await getPhaseWithDetails(phase.id, seasonId) : await getTournamentWithDetails(phase.id);
    const rounds = native ? await listRoundStatusesByPhaseIds([phase.id]) : await getRoundsByTournament(phase.id);
    return NextResponse.json<ApiResult<LeaguePhase>>({
      success: true,
      data: buildLeaguePhase(withDetails!, rounds),
      ...(formatReactionFailed ? { warnings: [{ code: 'format_reaction_failed' }] } : {}),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update phase');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;

    const native = (await requireOpenPhaseRouteMode()) === 'phase';
    const seasonId = native ? id.toLowerCase() : id;
    const phaseId = native ? requestedPhaseId.toLowerCase() : requestedPhaseId;
    if (native && !admin.isAdmin) {
      throw new UserFacingError('Admin access required', { status: 403, code: 'forbidden' });
    }
    const nativePhase = native ? await getPhaseWithDetails(phaseId, seasonId) : null;
    const target = native ? nativePhase : await getTournamentById(phaseId);
    if (!target || target.season_id !== seasonId.toLowerCase()) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    // The phase of an attached format is removed by replacing or detaching the format, never one by one (409 format_phase_owned).
    if (nativePhase) await assertFormatPhaseDeletable(seasonId, phaseId, nativePhase.format_stage_key !== null);
    else await assertFormatPhaseDeletable(seasonId, phaseId);

    let confirmed = false;
    if (native || (await getRoundsByTournament(phaseId)).length > 0) {
      // An empty body is "no confirmation"; a malformed one is 400 invalid_json.
      const text = await request.text();
      let rawBody: unknown = {};
      if (text.trim() !== '') {
        const body = await readJsonBody({ json: async () => JSON.parse(text) });
        if (!body.ok) return body.response;
        rawBody = body.value;
      }
      confirmed = phaseDeleteSchema.safeParse(rawBody).success;
      if (!native && !confirmed) {
        throw new UserFacingError(
          'Deleting a phase with rounds requires confirm: true',
          { code: 'PHASE_DELETE_CONFIRM_REQUIRED', status: 400 }
        );
      }
    }

    let playerIds: string[];
    let deletedName = target.name;
    if (native) {
      const deleted = await deleteAdminPhase(seasonId, phaseId, confirmed);
      deletedName = deleted.name;
      playerIds = deleted.playerIds;
      expirePhaseReads(phaseId, seasonId);
    } else {
      playerIds = (await getParticipants(phaseId)).map(p => p.id);
      await deleteTournament(phaseId);
      expireTournamentReads(phaseId, seasonId);
    }

    // The delete has committed: a rebuild failure is reported in the response
    // (`rebuild_warning`), not as a failed delete.
    let rebuild: EntityDeleteRebuildSummary | null = null;
    let rebuildWarning: DeleteRebuildWarning | null = null;
    try {
      rebuild = native
        ? await createMixedEntityDeleteRebuilder(async owner => expirePhaseReads(owner.phase_id, owner.season_id))
          .rebuildAfterPhaseDelete({ phaseId, seasonId, playerIds })
        : await rebuildAfterTournamentDelete({ tournamentId: phaseId, seasonId, playerIds });
    } catch (err) {
      logger.error('api/seasons', 'phase delete derived-data rebuild failed', {
        seasonId,
        phaseId,
        error: err,
      });
      // Reported to the admin in the response (catalogued code, e.g.
      // rating_history_incomplete) and kept in the audit record.
      rebuildWarning = toDeleteRebuildWarning(err);
    }
    // The rebuild rewrote ratings and streaks after the expiry above, so the rating reads of the players expire again now.
    expireRatingReads(playerIds);

    logAuditEvent({
      action: 'phase.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: native ? 'phase' : 'tournament',
      resource_id: phaseId,
      resource_name: deletedName,
      metadata: { season_id: seasonId, rebuild, rebuild_error: rebuildWarning?.code ?? null },
    });

    return NextResponse.json<ApiResult<EntityDeleteResult>>({
      success: true,
      data: { rebuild_warning: rebuildWarning },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete phase');
  }
}
