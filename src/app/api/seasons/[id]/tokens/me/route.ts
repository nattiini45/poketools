import { NextResponse } from 'next/server';
import { requirePlayer, requireResourceAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { tokensQuerySchema } from '@/lib/draft/schemas';
import type { ApiResult } from '@/types/api';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { buildTokenOverview, getEpbSeason, loadTokenSeasonContext } from '../_lib/overview';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/seasons/[id]/tokens/me[?player_id=] — one player's Draft Kill Token, Comeback Token
 * and Participation Token overview (draft-backend §8.1 #25, §10.3).
 *
 * Players read their own overview; `?player_id=` naming another player needs season admin
 * rights (unspent points and token plans are strategic information).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const query = tokensQuerySchema.parse({
      player_id: new URL(request.url).searchParams.get('player_id') ?? undefined,
    });
    const targetId = query.player_id ?? player.playerId;
    if (targetId !== player.playerId) {
      await requireResourceAdmin('season', id);
    }

    const season = await getEpbSeason(id);
    const ctx = await loadTokenSeasonContext(season, targetId);
    return NextResponse.json<ApiResult<TokenOverviewDTO>>({
      success: true,
      data: buildTokenOverview(ctx, targetId, new Date()),
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to fetch the token overview');
  }
}
