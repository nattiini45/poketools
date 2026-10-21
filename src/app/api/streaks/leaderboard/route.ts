import { NextResponse } from 'next/server';
import { getStreakLeaderboard } from '@/lib/supabase/queries/streaks';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';
import type { PlayerStreaks } from '@/types/streak';

// Public streak leaderboard
export async function GET() {
  try {
    const leaderboard = await getStreakLeaderboard();

    return NextResponse.json<ApiResult<PlayerStreaks[]>>({
      success: true,
      data: leaderboard,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch streak leaderboard');
  }
}
