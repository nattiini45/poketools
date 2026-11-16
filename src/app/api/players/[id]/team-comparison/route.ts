import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { safeErrorResponse } from '@/lib/api/error-response';
import { loadTeamComparison } from '@/lib/team-comparison.server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requirePlayer();
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PLAYER_ID');
    if (invalid) return invalid;
    const seasonId = request.nextUrl.searchParams.get('season_id') ?? undefined;
    if (seasonId) {
      const invalidSeason = rejectInvalidPathId(seasonId, 'INVALID_SEASON_ID');
      if (invalidSeason) return invalidSeason;
    }
    const data = await loadTeamComparison(viewer.playerId, id, seasonId);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compare teams');
  }
}
