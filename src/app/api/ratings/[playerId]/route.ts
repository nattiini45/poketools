import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import type { ApiResult } from '@/types/api';
import type { PlayerRating } from '@/types/rating';

interface RouteParams {
  params: Promise<{ playerId: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { playerId } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(playerId, 'INVALID_PLAYER_ID');
    if (invalidId) return invalidId;
    const rating = await getPlayerRating(playerId);

    return NextResponse.json<ApiResult<PlayerRating | null>>({
      success: true,
      data: rating,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player rating');
  }
}
