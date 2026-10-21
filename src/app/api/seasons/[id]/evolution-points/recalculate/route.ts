import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { recalculateEvolutionPoints } from '@/lib/draft/evolution-points-engine';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { RecalculateEvolutionPointsResult } from '@/lib/draft/evolution-points-engine';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/evolution-points/recalculate
 * Rebuild evolution-point counters from persisted development events.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<RecalculateEvolutionPointsResult>>> {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const result = await recalculateEvolutionPoints(id);
    expireSeasonReads(id);

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to recalculate evolution points');
  }
}
