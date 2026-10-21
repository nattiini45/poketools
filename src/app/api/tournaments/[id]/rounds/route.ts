import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import type { ApiResult } from '@/types/api';
import type { Round } from '@/types/round';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: no auth required — list rounds for a tournament
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const rounds = await getRoundsByTournament(id);
    return NextResponse.json<ApiResult<Round[]>>({
      success: true,
      data: rounds,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch rounds');
  }
}
