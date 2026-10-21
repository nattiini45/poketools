import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getTournamentsByPlayer } from '@/lib/supabase/queries/tournaments';
import type { ApiResult } from '@/types/api';
import type { TournamentWithDetails } from '@/types/tournament';

// Authenticated — get tournaments the current player participates in
export async function GET() {
  try {
    const player = await requirePlayer();
    const tournaments = await getTournamentsByPlayer(player.playerId);

    return NextResponse.json<ApiResult<TournamentWithDetails[]>>({
      success: true,
      data: tournaments,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch tournaments');
  }
}
