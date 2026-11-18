import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { phaseReorderSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { legacyPhasePersistence, nativePhasePersistence } from '@/lib/league-phase/lifecycle-persistence';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { expireSeasonReads } from '@/lib/revalidation';
import { assertSeasonPhasesFree } from '@/lib/format-studio/phase-guards';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/seasons/[id]/phases/reorder */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const rawBody = await request.json();
    const parsed = phaseReorderSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const mode = await requireOpenPhaseRouteMode();
    const persistence = mode === 'phase' ? nativePhasePersistence : legacyPhasePersistence;
    const seasonId = id.toLowerCase();
    const requested = parsed.data.phase_ids.map((phaseId) => phaseId.toLowerCase());
    // A league with an attached format keeps the order its format gave the phases (409 format_phase_owned).
    await assertSeasonPhasesFree(seasonId);

    const stages = await persistence.listBySeason(seasonId);
    const upcoming = stages.filter((s) => s.status === 'upcoming');
    const upcomingIds = new Set(upcoming.map((s) => s.id));
    const pinned = stages.filter((s) => s.status !== 'upcoming');

    for (const phaseId of requested) {
      if (!upcomingIds.has(phaseId)) {
        throw new UserFacingError(
          'Only upcoming phases can be reordered',
          { code: 'PHASE_REORDER_LOCKED', status: 400 }
        );
      }
    }

    const expectedUpcomingCount = upcoming.length;
    if (requested.length !== expectedUpcomingCount || new Set(requested).size !== expectedUpcomingCount) {
      throw new UserFacingError(
        'phase_ids must include every upcoming phase exactly once',
        { code: 'PHASE_REORDER_INCOMPLETE', status: 400 }
      );
    }

    const pinnedOrdered = [...pinned].sort((a, b) => a.stage_order - b.stage_order);
    const newOrder = [
      ...pinnedOrdered.map((p) => p.id),
      ...requested,
    ];

    await persistence.reorder(seasonId, newOrder);
    expireSeasonReads(seasonId, mode === 'phase' ? { phaseIds: newOrder } : newOrder);

    logAuditEvent({
      action: 'phase.reorder',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: { phase_ids: newOrder },
    });

    return NextResponse.json<ApiResult<{ phase_ids: string[] }>>({
      success: true,
      data: { phase_ids: newOrder },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reorder phases');
  }
}
