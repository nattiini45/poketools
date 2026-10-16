import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getPlayerById } from '@/lib/supabase/queries/players';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';

export async function GET() {
  try {
    const sessionPlayer = await requirePlayer();
    const player = await getPlayerById(sessionPlayer.playerId);

    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player record not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResult<Player>>({ success: true, data: player });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch profile');
  }
}
