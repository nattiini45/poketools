import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getSeasonTrackers,
  getPlayerTrackersWithTiers,
} from '@/lib/supabase/queries/evolutions';
import type { ApiResult } from '@/types/api';
import type { EvolutionTracker, EvolutionTrackerWithTier } from '@/types/evolution';

/**
 * GET /api/evolutions/trackers?season_id=X&player_id=Y
 *
 * Get evolution tracker state.
 * - With player_id: returns trackers enriched with tier definitions
 * - Without player_id: returns all trackers for the season
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResult<EvolutionTracker[] | EvolutionTrackerWithTier[]>>> {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');
    const playerId = searchParams.get('player_id');

    if (!seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'season_id is required', code: 'draft_season_id_required' },
        { status: 400 }
      );
    }

    if (playerId) {
      const trackers = await getPlayerTrackersWithTiers(seasonId, playerId);
      return NextResponse.json({ success: true, data: trackers });
    }

    const trackers = await getSeasonTrackers(seasonId);
    return NextResponse.json({ success: true, data: trackers });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch evolution trackers');
  }
}
