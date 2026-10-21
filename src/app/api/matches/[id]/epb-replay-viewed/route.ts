import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { hasViewedEpbReplay, markEpbReplayViewed } from '@/lib/supabase/queries/epb-animation-views';
import { getMatchById } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/matches/[id]/epb-replay-viewed
 * Whether the authenticated player has viewed this match's EPB evolution replay.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResult<{ viewed: boolean }>>> {
  try {
    const player = await requirePlayer();
    const { id: matchId } = await params;
    const invalidMatchId = rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalidMatchId) return invalidMatchId;

    const viewed = await hasViewedEpbReplay(player.playerId, matchId);
    return NextResponse.json({ success: true, data: { viewed } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to check replay viewed state');
  }
}

/**
 * POST /api/matches/[id]/epb-replay-viewed
 * Mark this match's EPB evolution replay as viewed for the authenticated player.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResult<{ viewed: true }>>> {
  try {
    const player = await requirePlayer();
    const { id: matchId } = await params;
    const invalidMatchId = rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalidMatchId) return invalidMatchId;

    const match = await getMatchById(matchId);
    if (!match) {
      return NextResponse.json({ success: false, error: 'Match not found', code: 'match_not_found' }, { status: 404 });
    }

    await markEpbReplayViewed(player.playerId, matchId);
    return NextResponse.json({ success: true, data: { viewed: true } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to mark replay as viewed');
  }
}
