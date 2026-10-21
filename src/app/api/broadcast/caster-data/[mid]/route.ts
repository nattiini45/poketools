import { NextRequest, NextResponse } from 'next/server';
import { requireCreator } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { fetchCasterData } from '@/lib/broadcast/caster-data';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mid: string }> }
) {
  try {
    const player = await requireCreator();
    const { mid } = await params;
    const invalidMid = rejectInvalidPathId(mid, 'INVALID_MATCH_ID');
    if (invalidMid) return invalidMid;

    const data = await fetchCasterData(mid, {
      viewerId: player.playerId,
      isAdmin: player.isAdmin,
    });
    if (!data) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    return NextResponse.json(data, {
      // Rosters depend on the viewer (spec §7), so no shared cache.
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch caster data');
  }
}
