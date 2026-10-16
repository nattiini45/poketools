import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { assertEpbSeason } from '@/lib/season/format-utils';
import {
  getTradeRequest,
  cancelTradeRequest,
} from '@/lib/supabase/queries/redraft-trade-requests';
import type { ApiResult } from '@/types/api';
import type { TradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';

interface RouteParams {
  params: Promise<{ id: string; rid: string }>;
}

/**
 * POST /api/seasons/[id]/redraft/trade-request/[rid]/cancel
 * Cancel a pending trade. Allowed for: a season resource admin, OR either
 * trade participant. Returns the cancelled request, or 409 if it is no longer
 * pending (already executed/cancelled).
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<TradeRequest>>> {
  try {
    const { id, rid } = await params;

    // Finding #4: cancel is an EPB-only operation — assert the season format
    // before any auth-branch or write (matches the redraft/create/consent routes).
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    // Prefer the resource-admin check: site/season admins may cancel any trade.
    // If that fails with a 403 AuthError, fall back to player auth + participant
    // check so a participant can cancel their own pending trade.
    let caller: { playerId: string; isAdmin: boolean };
    try {
      const admin = await requireResourceAdmin('season', id);
      caller = { playerId: admin.playerId, isAdmin: true };
    } catch (err) {
      if (!(err instanceof AuthError) || err.statusCode !== 403) throw err;
      const player = await requirePlayer();
      caller = { playerId: player.playerId, isAdmin: false };
    }

    const request = await getTradeRequest(rid);
    if (!request) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Trade request not found', code: 'trade_request_not_found' },
        { status: 404 }
      );
    }
    if (request.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Trade request does not belong to this season', code: 'trade_request_wrong_season' },
        { status: 400 }
      );
    }

    // A non-admin caller must be a participant.
    if (!caller.isAdmin) {
      const isParticipant =
        caller.playerId === request.player_a_id ||
        caller.playerId === request.player_b_id;
      if (!isParticipant) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'You are not a participant in this trade', code: 'trade_not_participant' },
          { status: 403 }
        );
      }
    }

    if (request.status !== 'pending') {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Trade is already ${request.status}`,
          code: request.status === 'executed' ? 'trade_already_executed' : 'trade_already_cancelled',
        },
        { status: 409 }
      );
    }

    const cancelled = await cancelTradeRequest(rid, caller.playerId);
    if (!cancelled) {
      // Lost a race: the request was executed/cancelled concurrently.
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Trade is no longer pending', code: 'trade_no_longer_pending' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data: cancelled });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to cancel trade request');
  }
}