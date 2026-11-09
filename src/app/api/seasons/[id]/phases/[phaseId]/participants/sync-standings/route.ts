import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { syncStandingsSchema, formatZodErrors } from '@/lib/validation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { assertFormatPhaseRosterOpen } from '@/lib/format-studio/phase-guards';
import { auditRosterOverride, rosterOverrideOf } from '@/lib/format-studio/roster-override';
import type { ApiResult } from '@/types/api';
import type { SyncStandingsResult } from '@/lib/tournament/enrollment-sync';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

async function assertPhaseInSeason(seasonId: string, phaseId: string) {
  const phase = await getTournamentById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new UserFacingError('Phase not found in this league', {
      code: 'PHASE_NOT_FOUND',
      status: 404,
    });
  }
  return phase;
}

/** POST /api/seasons/[id]/phases/[phaseId]/participants/sync-standings */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const phase = await assertPhaseInSeason(id, phaseId);

    const rawBody = request.headers.get('content-length') === '0'
      ? {}
      : await request.json();
    // The roster of a format phase that has started is not synced here (409 format_phase_owned) unless the request forces it
    // with a reason (`force` also lifts the frozen/rounds checks of the sync itself, which a started phase always trips).
    const override = await assertFormatPhaseRosterOpen(id, phase, rosterOverrideOf(rawBody));
    const parsed = syncStandingsSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await syncStandingsEnrollment(id, phaseId, parsed.data);
    expireTournamentReads(phaseId, id);

    if (override) {
      auditRosterOverride(admin, id, phase, override, 'sync', { enrolled_count: result.enrolled_count });
    }

    // A forced sync enrolls past the checks that guard a normal one: it leaves a trail.
    if (parsed.data.force) {
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'phase.enrollment.sync',
        resource_type: 'phase',
        resource_id: phaseId,
        metadata: {
          season_id: id,
          force: true,
          source_phase: parsed.data.source_phase_id ?? result.source_phase_name,
          enrolled_count: result.enrolled_count,
        },
      });
    }

    return NextResponse.json<ApiResult<SyncStandingsResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to sync standings enrollment');
  }
}
