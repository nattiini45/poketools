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
  updateTournament,
  deleteTournament,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { buildLeaguePhase, assertPhaseEditable } from '@/lib/tournament/league-phase';
import {
  rebuildAfterTournamentDelete,
  type EntityDeleteRebuildSummary,
} from '@/lib/reconcile/entity-delete-rebuild';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { LeaguePhase } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

export const maxDuration = 300;

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
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

    const tournament = await getTournamentById(phaseId);
    if (!tournament || tournament.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rounds = await getRoundsByTournament(phaseId);
    if (rounds.length > 0) {
      const rawBody = request.headers.get('content-length') === '0'
        ? {}
        : await request.json();
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

    let rebuild: EntityDeleteRebuildSummary | null = null;
    let rebuildError: string | null = null;
    try {
      rebuild = await rebuildAfterTournamentDelete({
        tournamentId: phaseId,
        seasonId: id,
        playerIds: participants.map((p) => p.id),
      });
    } catch (err) {
      console.error('phase delete derived-data rebuild failed:', err);
      rebuildError = 'derived_data_rebuild_failed';
    }

    logAuditEvent({
      action: 'phase.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'tournament',
      resource_id: phaseId,
      resource_name: tournament.name,
      metadata: { season_id: id, rebuild, rebuild_error: rebuildError },
    });

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete phase');
  }
}
