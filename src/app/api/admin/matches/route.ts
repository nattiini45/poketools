import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { listAllMatchesWithTournament } from '@/lib/supabase/queries/matches';
import type { MatchWithTournament } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import type { MatchStatus } from '@/types/match';

/** GET /api/admin/matches?tournament_id=X&status=X — list all matches with filters */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const tournamentId = searchParams.get('tournament_id') ?? undefined;
    const status = (searchParams.get('status') as MatchStatus) ?? undefined;

    const matches = await listAllMatchesWithTournament({
      tournament_id: tournamentId,
      status,
    });

    return NextResponse.json<ApiResult<MatchWithTournament[]>>({
      success: true,
      data: matches,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to list matches');
  }
}
