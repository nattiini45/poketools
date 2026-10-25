import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  phaseUpdateSchema,
  phaseDeleteSchema,
  formatZodErrors,
} from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent, diffField } from '@/lib/audit/log';
import {
  getTournamentById,
  getTournamentWithDetails,
  getStagesBySeasonId,
  updateTournament,
  deleteTournament,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { newEvenBestOfIssues } from '@/lib/tournament/best-of';
import { buildLeaguePhase,assertPhaseEditable, assertPhaseNameFree } from '@/lib/tournament/league-phase';
import {
  rebuildAfterTournamentDelete,
  type EntityDeleteRebuildSummary,
} from '@/lib/reconcile/entity-delete-rebuild';
import { expireTournamentReads } from '@/lib/revalidation';
import { readJsonBody } from '@/lib/api/json-body';
import {
  toDeleteRebuildWarning,
  type DeleteRebuildWarning,
  type EntityDeleteResult,
} from '@/lib/api/delete-rebuild-warning';
import type { ApiResult } from '@/types/api';
import type { LeaguePhase } from '@/types/season';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

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
    const tournament = await getTournamentWithDetails(phaseId);
    if (!tournament || tournament.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rounds = await getRoundsByTournament(phaseId);
    return NextResponse.json<ApiResult<LeaguePhase>>({
      success: true,
      data: buildLeaguePhase(tournament, rounds),
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

    const before = await getTournamentById(phaseId);
    if (!before || before.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    const parsed = phaseUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = parsed.data;

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

    // A rename may not take another phase's name. Saving the unchanged name
    // passes, so a league that already holds duplicates stays editable.
    if (body.name !== undefined && body.name.toLowerCase() !== before.name.trim().toLowerCase()) {
      assertPhaseNameFree(body.name, await getStagesBySeasonId(id), phaseId);
    }

    const tournament = await updateTournament(phaseId, body);
    expireTournamentReads(phaseId, id);

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    diffField(changes, 'name', before.name, tournament.name);
    diffField(changes, 'status', before.status, tournament.status);
    diffField(changes, 'bracket_type', before.bracket_type, tournament.bracket_type);
    if (Object.keys(changes).length > 0) {
      logAuditEvent({
        action: 'phase.update',
        actor_id: admin.playerId,
        actor_name: admin.name,
        resource_type: 'tournament',
        resource_id: phaseId,
        resource_name: tournament.name,
        changes,
      });
    }

    const withDetails = await getTournamentWithDetails(phaseId);
    const rounds = await getRoundsByTournament(phaseId);
    return NextResponse.json<ApiResult<LeaguePhase>>({
      success: true,
      data: buildLeaguePhase(withDetails!, rounds),
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update phase');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;

    const tournament = await getTournamentById(phaseId);
    if (!tournament || tournament.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rounds = await getRoundsByTournament(phaseId);
    if (rounds.length > 0) {
      // An empty body is "no confirmation"; a malformed one is 400 invalid_json.
      const text = await request.text();
      let rawBody: unknown = {};
      if (text.trim() !== '') {
        const body = await readJsonBody({ json: async () => JSON.parse(text) });
        if (!body.ok) return body.response;
        rawBody = body.value;
      }
      const parsed = phaseDeleteSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new UserFacingError(
          'Deleting a phase with rounds requires confirm: true',
          { code: 'PHASE_DELETE_CONFIRM_REQUIRED', status: 400 }
        );
      }
    }

    const participants = await getParticipants(phaseId);
    await deleteTournament(phaseId);
    expireTournamentReads(phaseId, id);

    // The delete has committed: a rebuild failure is reported in the response
    // (`rebuild_warning`), not as a failed delete.
    let rebuild: EntityDeleteRebuildSummary | null = null;
    let rebuildWarning: DeleteRebuildWarning | null = null;
    try {
      rebuild = await rebuildAfterTournamentDelete({
        tournamentId: phaseId,
        seasonId: id,
        playerIds: participants.map((p) => p.id),
      });
    } catch (err) {
      console.error('phase delete derived-data rebuild failed:', err);
      // Reported to the admin in the response (catalogued code, e.g.
      // rating_history_incomplete) and kept in the audit record.
      rebuildWarning = toDeleteRebuildWarning(err);
    }

    logAuditEvent({
      action: 'phase.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'tournament',
      resource_id: phaseId,
      resource_name: tournament.name,
      metadata: { season_id: id, rebuild, rebuild_error: rebuildWarning?.code ?? null },
    });

    return NextResponse.json<ApiResult<EntityDeleteResult>>({
      success: true,
      data: { rebuild_warning: rebuildWarning },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete phase');
  }
}
