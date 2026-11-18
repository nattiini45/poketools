import { type NextRequest, NextResponse } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requirePlayer } from '@/lib/auth/helpers';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { markPhaseEpbReplayViewed } from '@/lib/supabase/queries/phase-epb-animation-views';
import { findNativePhaseAliasOwner } from '@/lib/supabase/queries/phase-route-owners';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string; matchId: string }> },
) {
  try {
    const player = await requirePlayer();
    const { id, phaseId, matchId } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_SEASON_ID')
      ?? rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID')
      ?? rejectInvalidPathId(matchId, 'INVALID_MATCH_ID');
    if (invalid) return invalid;

    const nativeMatchId = matchId.toLowerCase();
    const owner = await requireOpenPhaseRouteMode() === 'phase'
      ? await findNativePhaseAliasOwner({ phaseId: phaseId.toLowerCase(), matchId: nativeMatchId })
      : null;
    if (owner?.season_id !== id.toLowerCase()) {
      throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    }

    await markPhaseEpbReplayViewed(player.playerId, nativeMatchId);
    return NextResponse.json({ success: true, data: { viewed: true } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to mark replay as viewed');
  }
}
