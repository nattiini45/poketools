import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import type { ApiResult } from '@/types/api';
import type { EarnedAchievement } from '@/types/achievement';

interface RouteParams {
  params: Promise<{ playerId: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { playerId } = await params;
    const achievements = await getPlayerAchievements(playerId);

    return NextResponse.json<ApiResult<EarnedAchievement[]>>({
      success: true,
      data: achievements,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player achievements');
  }
}
