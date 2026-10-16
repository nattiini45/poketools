import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { phaseGroupsRepairSchema, formatZodErrors } from '@/lib/validation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { repairPhaseGroups, type GroupRepairApplyLog } from '@/lib/season/repair-phase-groups';
import { logAuditEvent, type AuditLogEntry } from '@/lib/audit/log';
import { expireTournamentReads } from '@/lib/revalidation';
import type { GroupRepairMove, GroupRepairResult } from '@/lib/season/group-repair';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

function auditMove(move: GroupRepairMove) {
  return {
    group_id: move.group_id,
    from_player_id: move.from_player_id,
    to_player_id: move.to_player_id,
    basis: move.basis,
  };
}

/** The `season.phase.groups.repair` entry for the moves that landed. */
function repairAuditEntry(
  actor: { playerId: string; name: string },
  seasonId: string,
  phaseId: string,
  moves: readonly GroupRepairMove[],
  extra: Record<string, unknown> = {},
): AuditLogEntry {
  return {
    actor_id: actor.playerId,
    actor_name: actor.name,
    action: 'season.phase.groups.repair',
    resource_type: 'season',
    resource_id: seasonId,
    metadata: { phase_id: phaseId, moves: moves.map(auditMove), ...extra },
  };
}

/**
 * After an apply that stopped partway, expire the phase's reads so its pages
 * do not keep serving the pre-write state. The repair's own error is what the
 * caller gets, and the partial audit still runs: a failure here is only
 * logged.
 */
function expireAfterFailedApply(phaseId: string, seasonId: string): void {
  try {
    expireTournamentReads(phaseId, seasonId);
  } catch (expireErr) {
    console.error('[groups/repair] read-cache expiry after a failed apply failed:', expireErr);
  }
}

/**
 * POST /api/seasons/[id]/phases/[phaseId]/groups/repair
 *
 * Hand the group rows that substitutions from before the group handover left
 * with the departed player to the enrolled substitute (paired from the
 * substitution audit log, else from the fixtures). `dry_run: true` returns the
 * plan only; `dry_run: false` applies it, given the `moves` the admin reviewed
 * (409 `PLAN_CHANGED`, nothing written, when the fresh plan differs). What
 * cannot be paired is reported and left as it is.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: seasonId, phaseId } = await params;
    const admin = await requireResourceAdmin('season', seasonId);

    const rawBody = await request.json().catch(() => null);
    const parsed = phaseGroupsRepairSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const phase = await getTournamentById(phaseId);
    if (!phase || phase.season_id !== seasonId) {
      throw new UserFacingError('Phase not found in this league', {
        code: 'PHASE_NOT_FOUND',
        status: 404,
      });
    }

    const body = parsed.data;
    const log: GroupRepairApplyLog = { written: [], stopped_at: null };
    let result: GroupRepairResult;
    try {
      result = await repairPhaseGroups(
        body.dry_run
          ? { seasonId, phaseId, dryRun: true }
          : { seasonId, phaseId, dryRun: false, reviewed: body.moves, log },
      );
    } catch (err) {
      // A failure inside the apply (`stopped_at` set): each move is its own
      // write, so the ones before the failure have landed. A re-run no longer
      // plans them, so they are recorded now, with the move the apply stopped
      // at (and whether its own row moved). A failure before the apply wrote
      // nothing records nothing.
      const stop = log.stopped_at;
      if (stop) {
        expireAfterFailedApply(phaseId, seasonId);
        if (log.written.length > 0 || stop.written) {
          void logAuditEvent(
            repairAuditEntry(admin, seasonId, phaseId, log.written, {
              partial: true,
              failure_code: err instanceof UserFacingError ? (err.code ?? null) : null,
              stopped_at: {
                ...auditMove(stop.move),
                written: stop.written,
                held_group_ids: stop.held_group_ids,
              },
            }),
          );
        }
      }
      throw err;
    }

    if (result.applied) {
      expireTournamentReads(phaseId, seasonId);
      void logAuditEvent(repairAuditEntry(admin, seasonId, phaseId, result.moves));
    }

    return NextResponse.json<ApiResult<GroupRepairResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to repair phase groups');
  }
}
