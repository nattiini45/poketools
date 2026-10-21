import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import type { MatchWithPlayers } from '@/types/match';

// Authenticated — get current player's matches
export async function GET() {
  try {
    const player = await requirePlayer();
    const matches = await getMatchesByPlayer(player.playerId);

    return NextResponse.json<ApiResult<MatchWithPlayers[]>>({
      success: true,
      data: matches,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch matches');
  }
}
