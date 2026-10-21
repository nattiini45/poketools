import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import type { ApiResult } from '@/types/api';
import type { TournamentGroupWithMembers } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: no auth required — list groups with members
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const groups = await getGroupsByTournament(id);
    return NextResponse.json<ApiResult<TournamentGroupWithMembers[]>>({
      success: true,
      data: groups,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch groups');
  }
}
