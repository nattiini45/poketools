import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { epbPack } from '@/lib/format-pack';
import { prepareRedraftSwap, type RedraftSwapRefusal } from '@/lib/draft/redraft-engine';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { assertEpbSeason } from '@/lib/season/format-utils';
import {
  getTradeRequest,
  setConsent,
  executeTradeRequest,
  TradeRequestExecutionError,
} from '@/lib/supabase/queries/redraft-trade-requests';
import { loadTradeSidesFresh } from '@/lib/draft/trade-consent';
import { expireDraftReads } from '@/lib/revalidation';
import type { ApiError, ApiResult } from '@/types/api';
import type { TradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';

interface RouteParams {
  params: Promise<{ id: string; rid: string }>;
}

/**
 * The code (and params) for a side whose swap `prepareRedraftSwap` refused:
 * the engine's own refusal code when it gave one, else the side's generic
 * `trade_side_{a,b}_invalid {reason}`.
 */
function sideRefusal(
  refusal: RedraftSwapRefusal | undefined,
  fallback: 'trade_side_a_invalid' | 'trade_side_b_invalid',
  reason: string | undefined
): Pick<ApiError, 'code' | 'params'> {
  if (refusal) return refusal.params ? { code: refusal.code, params: { ...refusal.params } } : { code: refusal.code };
  return { code: fallback, params: { reason: reason ?? 'validation error' } };
}

/**
 * POST /api/seasons/[id]/redraft/trade-request/[rid]/consent
 * A player consents to a pending trade they are a side of. The caller must be
 * player_a_id or player_b_id (else 403).
 *
 * Flow:
 *  1. Load request; if not pending -> idempotent success (already done).
 *  2. setConsent for the caller's side; reload.
 *  3. If not both consented yet -> return the pending request.
 *  4. If both consented -> re-resolve FRESH swap payloads (trackers + entries +
 *     computeRemainingPoints for BOTH sides + prepareRedraftSwap). If either
 *     prepare errors -> 409 (request stays pending; no RPC call).
 *  5. Call the single atomic RPC `epb_execute_trade_request`, which in ONE
 *     transaction: row-locks the request, claims it (pending AND both
 *     consented), re-checks redraft_phase_open, re-checks each side's remaining
 *     points IN SQL, runs the swap (reuse of epb_execute_redraft), and flips
 *     status to 'executed' with the new tracker ids. Any failure rolls the
 *     whole transaction back — there is NO TS claim/revert, so a retry cannot
 *     double-execute and a crash cannot leave an 'executed' row without a swap.
 *  6. On RPC error -> reload; if the request is now 'executed' another caller
 *     won the race and finished it (idempotent executed response), else return
 *     409 with the RPC's message (phase_closed / insufficient_points /
 *     free-line / ownership) — the request is still pending and retryable.
 *  7. On success -> return the reloaded executed request.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<TradeRequest>>> {
  try {
    const { id, rid } = await params;
    const player = await requirePlayer();

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

    // Finding #4: the consent endpoint must assert EPB (matches the redraft +
    // create routes). Done before any write so a non-EPB season never mutates
    // trade-consent state.
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    // Caller must be one of the two trade sides.
    let side: 'a' | 'b';
    if (player.playerId === request.player_a_id) {
      side = 'a';
    } else if (player.playerId === request.player_b_id) {
      side = 'b';
    } else {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'You are not a participant in this trade', code: 'trade_not_participant' },
        { status: 403 }
      );
    }

    // Not pending anymore -> idempotent success with current state.
    if (request.status !== 'pending') {
      return NextResponse.json({ success: true, data: request });
    }

    // Idempotent consent: if this side already consented, no-op update is fine.
    await setConsent(rid, side);

    // Reload to read the authoritative consent flags.
    const current = await getTradeRequest(rid);
    if (!current) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Trade request not found', code: 'trade_request_not_found' },
        { status: 404 }
      );
    }

    // Not both consented yet -> still pending, return current state.
    if (!(current.consent_a && current.consent_b)) {
      return NextResponse.json({ success: true, data: current });
    }

    // Both consented. Re-resolve FRESH swap payloads before calling the RPC.
    // The RPC re-checks phase + points inside its transaction, but the payload
    // (new_tracker / history / points_spent) is computed here in TS — a stale
    // payload would let the RPC finalise a swap built from a stale snapshot.
    if (!season || !season.point_buy_list_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'No point-buy list is bound to this season', code: 'point_buy_list_unbound' },
        { status: 400 }
      );
    }

    const rules = await getFormatRules(id);
    const budget = rules?.draft_budget ?? epbPack.defaults.draftBudget;
    const ratio = rules?.draft_token_ratio ?? epbPack.defaults.tokenRatio;

    const { trackerA, trackerB, entryA, entryB } = await loadTradeSidesFresh(
      id,
      current,
      season.point_buy_list_id
    );

    const [remainingA, remainingB] = await Promise.all([
      computeRemainingPoints(id, current.player_a_id, budget, ratio),
      computeRemainingPoints(id, current.player_b_id, budget, ratio),
    ]);

    const [sideAResult, sideBResult] = await Promise.all([
      prepareRedraftSwap({
        season_id: id,
        player_id: current.player_a_id,
        from_tracker_id: trackerA.id,
        to_line: entryB,
        transfer_type: 'trade',
        trade_partner_id: current.player_b_id,
        remaining_points: remainingA,
      }),
      prepareRedraftSwap({
        season_id: id,
        player_id: current.player_b_id,
        from_tracker_id: trackerB.id,
        to_line: entryA,
        transfer_type: 'trade',
        trade_partner_id: current.player_a_id,
        remaining_points: remainingB,
      }),
    ]);

    if (!sideAResult.swap) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: sideAResult.error ?? 'Player A side failed validation',
          ...sideRefusal(sideAResult.refusal, 'trade_side_a_invalid', sideAResult.error),
        },
        { status: 409 }
      );
    }
    if (!sideBResult.swap) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Player B side failed: ${sideBResult.error ?? 'validation error'}`,
          ...sideRefusal(sideBResult.refusal, 'trade_side_b_invalid', sideBResult.error),
        },
        { status: 409 }
      );
    }

    // Single atomic RPC: claim + phase check + points check + swap + finalize.
    // On any failure its transaction rolls back automatically — no TS revert.
    try {
      await executeTradeRequest(rid, [
        sideAResult.swap.payload,
        sideBResult.swap.payload,
      ]);
    } catch (err) {
      // Reload to distinguish "another caller won the race and finalized it"
      // (idempotent executed) from "the RPC aborted and the request is still
      // pending" (retryable 409). The RPC never leaves a half-done row.
      // Log the RPC error in both branches — even the idempotent-success path
      // swallows a real exception that must stay diagnosable (no suppression).
      const after = await getTradeRequest(rid);
      if (after?.status === 'executed') {
        console.error('Trade request executed concurrently (idempotent success):', err);
        return NextResponse.json({ success: true, data: after });
      }
      if (err instanceof TradeRequestExecutionError) {
        console.error('Trade request execution rejected by RPC:', err);
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: err.message, code: err.code, params: err.params },
          { status: 409 }
        );
      }
      throw err;
    }

    expireDraftReads(id);

    const executed = await getTradeRequest(rid);
    return NextResponse.json({ success: true, data: executed ?? current });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to record trade consent');
  }
}