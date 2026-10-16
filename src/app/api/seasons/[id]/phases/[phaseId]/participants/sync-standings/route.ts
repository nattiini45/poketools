import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { syncStandingsSchema, formatZodErrors } from '@/lib/validation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { SyncStandingsResult } from '@/lib/tournament/enrollment-sync';

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
    await requireResourceAdmin('season', id);
    await assertPhaseInSeason(id, phaseId);

    const rawBody = request.headers.get('content-length') === '0'
      ? {}
      : await request.json();
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

    return NextResponse.json<ApiResult<SyncStandingsResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to sync standings enrollment');
  }
}
