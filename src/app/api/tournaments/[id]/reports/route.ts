import { NextRequest, NextResponse } from 'next/server';
import { getTournamentReports } from '@/lib/supabase/queries/tournament-reports';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import type { ApiResult } from '@/types/api';
import type { TournamentReport } from '@/types/tournament-report';

// ─── GET: List all reports for a tournament (public) ─────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const reports = await getTournamentReports(id);

    return NextResponse.json<ApiResult<TournamentReport[]>>({
      success: true,
      data: reports,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list tournament reports');
  }
}
