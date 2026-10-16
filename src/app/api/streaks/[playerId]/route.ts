import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import type { ApiResult } from '@/types/api';
import type { PlayerStreaks } from '@/types/streak';

interface RouteParams {
  params: Promise<{ playerId: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { playerId } = await params;
    const streaks = await getPlayerStreaks(playerId);

    return NextResponse.json<ApiResult<PlayerStreaks | null>>({
      success: true,
      data: streaks,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player streaks');
  }
}
