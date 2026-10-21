import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getRatingHistory } from '@/lib/supabase/queries/ratings';
import type { ApiResult } from '@/types/api';
import type { RatingHistoryEntry } from '@/types/rating';

interface RouteParams {
  params: Promise<{ playerId: string }>;
}

// Public: no auth required
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { playerId } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(playerId, 'INVALID_PLAYER_ID');
    if (invalidId) return invalidId;
    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 30;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 200)
      : 30;

    const history = await getRatingHistory(playerId, limit);

    return NextResponse.json<ApiResult<RatingHistoryEntry[]>>({
      success: true,
      data: history,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch rating history');
  }
}
