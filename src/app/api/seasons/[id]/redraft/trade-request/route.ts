import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { tradeRequestCreateSchema } from '@/lib/validation/schemas';
import {
  resolveTradeSides,
  createPendingTradeRequest,
} from '@/lib/draft/trade-consent';
import type { ApiResult } from '@/types/api';
import type { TradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/redraft/trade-request
 * Admin (site or season resource admin) initiates a two-sided trade. Creates a
 * PENDING request awaiting consent from BOTH players — does NOT execute. The
 * actual swap happens only after both players consent (see the consent route).
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<TradeRequest>>> {
  try {
    const { id } = await params;
    const player = await requireResourceAdmin('season', id);

    const body = await request.json();
    const parsed = tradeRequestCreateSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { player_a_id, from_tracker_a_id, player_b_id, from_tracker_b_id } = parsed.data;

    // A trade needs both source lines to exist right now.
    if (!from_tracker_a_id || !from_tracker_b_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Both source trackers are required to initiate a trade', code: 'trade_source_trackers_required' },
        { status: 400 }
      );
    }

    const season = await getSeasonById(id);
    assertEpbSeason(season);
    if (!season || !season.point_buy_list_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'No point-buy list is bound to this season', code: 'point_buy_list_unbound' },
        { status: 400 }
      );
    }

    const rules = await getFormatRules(id);
    if (!rules?.redraft_phase_open) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Redraft phase is not open for this season', code: 'redraft_phase_not_open' },
        { status: 403 }
      );
    }

    const sides = await resolveTradeSides(
      id,
      player_a_id,
      from_tracker_a_id,
      player_b_id,
      from_tracker_b_id,
      season.point_buy_list_id
    );

    const tradeRequest = await createPendingTradeRequest(id, player.playerId, sides);

    return NextResponse.json({
      success: true,
      data: tradeRequest,
    });
  } catch (err) {
    // TradeConsentError extends UserFacingError — safeErrorResponse passes
    // its message + status through and logs it server-side.
    return safeErrorResponse(err, 'Failed to initiate trade request');
  }
}