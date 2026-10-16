import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
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
