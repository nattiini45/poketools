import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { assertEpbSeason } from '@/lib/season/format-utils';
import {
  getPendingTradeRequestsForPlayer,
  getPendingTradeRequestsForSeason,
} from '@/lib/supabase/queries/redraft-trade-requests';
import type { ApiResult } from '@/types/api';
import type { TradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export interface TradeRequestsListData {
  /** Pending requests involving the caller (always present). */
  mine: TradeRequest[];
  /** All pending requests for the season (only populated for site admins). */
  all?: TradeRequest[];
}

/**
 * GET /api/seasons/[id]/redraft/trade-requests
 * Pending trade requests. Any authenticated player gets the requests that
 * involve them (as either side). Site admins additionally receive all pending
 * requests for the season under `all`.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<TradeRequestsListData>>> {
  try {
    const { id } = await params;
    const player = await requirePlayer();

    // Finding #4: trade requests are an EPB-only feature — assert the season
    // format before returning any rows (matches the redraft/create/consent/cancel
    // routes), so non-EPB seasons never expose trade-consent state.
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const mine = await getPendingTradeRequestsForPlayer(id, player.playerId);

    // Site admins get the full season view; resource-admin scope is enforced
    // separately by the resource-admin check elsewhere, so here we only expand
    // for site admins to avoid an extra DB lookup on every list call.
    if (player.isAdmin) {
      const all = await getPendingTradeRequestsForSeason(id);
      return NextResponse.json({ success: true, data: { mine, all } });
    }

    return NextResponse.json({ success: true, data: { mine } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch trade requests');
  }
}