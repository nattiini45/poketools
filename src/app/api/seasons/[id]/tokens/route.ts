import { NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import type { ApiResult } from '@/types/api';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { buildTokenOverview, getEpbSeason, loadTokenSeasonContext } from './_lib/overview';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface TokenOverviews {
  overviews: TokenOverviewDTO[];
}

/**
 * GET /api/seasons/[id]/tokens — every participant's token overview for season admins
 * (FE `TokenAdminSummary`). One set of season reads serves all
 * participants. Participant rows are reduced to their ids here: no player row leaves the route.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const season = await getEpbSeason(id);
    const [participants, ctx] = await Promise.all([getSeasonParticipants(id), loadTokenSeasonContext(season)]);
    const playerIds = [...new Set(participants.map((p) => p.id))].sort();

    const now = new Date();
    return NextResponse.json<ApiResult<TokenOverviews>>({
      success: true,
      data: { overviews: playerIds.map((playerId) => buildTokenOverview(ctx, playerId, now)) },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to fetch the token overviews');
  }
}
