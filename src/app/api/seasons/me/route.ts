import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonsByPlayer } from '@/lib/supabase/queries/seasons';
import type { ApiResult } from '@/types/api';
import type { SeasonWithDetails } from '@/types/season';

// Authenticated — get leagues/seasons the current player participates in
export async function GET() {
  try {
    const player = await requirePlayer();
    const seasons = await getSeasonsByPlayer(player.playerId);

    return NextResponse.json<ApiResult<SeasonWithDetails[]>>({
      success: true,
      data: seasons,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch seasons');
  }
}
