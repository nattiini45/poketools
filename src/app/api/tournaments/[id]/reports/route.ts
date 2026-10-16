import { NextRequest, NextResponse } from 'next/server';
import { getTournamentReports } from '@/lib/supabase/queries/tournament-reports';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import type { TournamentReport } from '@/types/tournament-report';

// ─── GET: List all reports for a tournament (public) ─────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reports = await getTournamentReports(id);

    return NextResponse.json<ApiResult<TournamentReport[]>>({
      success: true,
      data: reports,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list tournament reports');
  }
}
