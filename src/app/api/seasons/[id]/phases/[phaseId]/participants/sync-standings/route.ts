import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { syncStandingsSchema, formatZodErrors } from '@/lib/validation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { nativePhasePersistence } from '@/lib/league-phase/lifecycle-persistence';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { createNativePhaseEnrollment } from '@/lib/league-phase/enrollment-services';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { expirePhaseReads, expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { assertFormatPhaseRosterOpen } from '@/lib/format-studio/phase-guards';
import { auditRosterOverride, rosterOverrideOf } from '@/lib/format-studio/roster-override';
import type { ApiResult } from '@/types/api';
import type { SyncStandingsResult } from '@/lib/tournament/enrollment-sync';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

/** POST /api/seasons/[id]/phases/[phaseId]/participants/sync-standings */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const mode = await requireOpenPhaseRouteMode();
    const seasonId = mode === 'phase' ? id.toLowerCase() : id;
    const phaseId = mode === 'phase' ? requestedPhaseId.toLowerCase() : requestedPhaseId;
    const nativePhase = mode === 'phase' ? await nativePhasePersistence.getById(phaseId) : null;
    const phase = mode === 'phase' ? nativePhase : await getTournamentById(phaseId);
    if (!phase || phase.season_id !== seasonId) {
      throw new UserFacingError('Phase not found in this league', {
        code: 'PHASE_NOT_FOUND',
        status: 404,
      });
    }

    const rawBody = request.headers.get('content-length') === '0'
      ? {}
      : await request.json();
    // The roster of a format phase that has started is not synced here (409 format_phase_owned) unless the request forces it
    // with a reason (`force` also lifts the frozen/rounds checks of the sync itself, which a started phase always trips).
    const rosterOverride = rosterOverrideOf(rawBody);
    const override = nativePhase
      ? await assertFormatPhaseRosterOpen(seasonId, nativePhase, rosterOverride, nativePhase.format_stage_key !== null)
      : await assertFormatPhaseRosterOpen(seasonId, phase, rosterOverride);
    const parsed = syncStandingsSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = mode === 'phase'
      ? await createNativePhaseEnrollment().sync(seasonId, phaseId, parsed.data)
      : await syncStandingsEnrollment(seasonId, phaseId, parsed.data);
    if (mode === 'phase') expirePhaseReads(phaseId, seasonId);
    else expireTournamentReads(phaseId, seasonId);

    if (override) {
      auditRosterOverride(admin, seasonId, phase, override, 'sync', { enrolled_count: result.enrolled_count });
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
          season_id: seasonId,
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
