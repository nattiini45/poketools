import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { epbPack } from '@/lib/format-pack';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import {
  getRedraftEligibleLines,
  prepareRedraftSwap,
  type RedraftSwapRefusal,
} from '@/lib/draft/redraft-engine';
import { entryForTracker, trackerHoldsEntry } from '@/lib/draft/point-buy-pool';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { redraftExecuteSchema } from '@/lib/validation/schemas';
import { createPendingTradeRequest } from '@/lib/draft/trade-consent';
import { expireDraftReads } from '@/lib/revalidation';
import { retiredResponse } from '../tokens/_lib/retired';
import type { ApiError, ApiResult } from '@/types/api';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { TradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RedraftState {
  eligible_lines: EvolutionTracker[];
  list_entries: PointBuyListEntry[];
  remaining_points: number;
  redraft_phase_open: boolean;
}

/**
 * GET /api/seasons/[id]/redraft?player_id=X
 * Redraft state for a player: their eligible (not redraft-locked) lines, the bound
 * point-buy list and server-computed remaining points. (The retired free swap's
 * `free_lines` is gone: the secret-drop redraft has its own pool.)
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<RedraftState>>> {
  try {
    const { id } = await params;
    const player = await requirePlayer();

    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('player_id') ?? player.playerId;

    // Remaining points and eligible lines are strategically sensitive:
    // players may only view their own redraft state, admins may view any.
    if (playerId !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'You can only view your own redraft state', code: 'redraft_state_not_own' },
        { status: 403 }
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

    const listEntries = await getListEntries(season.point_buy_list_id);
    const rules = await getFormatRules(id);

    const [eligibleLines, remainingPoints] = await Promise.all([
      getRedraftEligibleLines(id, playerId, listEntries),
      computeRemainingPoints(id, playerId, rules?.draft_budget ?? epbPack.defaults.draftBudget, rules?.draft_token_ratio ?? epbPack.defaults.tokenRatio),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        eligible_lines: eligibleLines,
        list_entries: listEntries,
        remaining_points: remainingPoints,
        redraft_phase_open: rules?.redraft_phase_open ?? false,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch redraft state');
  }
}

interface RedraftPreviewData {
  preview: {
    valid: boolean;
    points_spent: number;
    missing_kills_transferred: number;
    new_stage: number;
    new_form: string;
    new_total_kos: number;
    partner_points_spent?: number;
  };
}

/**
 * The code (and params) of a swap side `prepareRedraftSwap` refused: its
 * `errors/draft-legacy` refusal, forwarded as-is. Every refusing return of the
 * engine carries one; without it the body stays uncoded (English fallback).
 */
function refusalCode(refusal: RedraftSwapRefusal | undefined): Pick<ApiError, 'code' | 'params'> {
  if (!refusal) return {};
  return refusal.params ? { code: refusal.code, params: { ...refusal.params } } : { code: refusal.code };
}

interface RedraftTradePendingData {
  pending: true;
  trade_request: TradeRequest;
  message: string;
}

/**
 * POST /api/seasons/[id]/redraft
 * - free_swap: RETIRED — answers `410 REDRAFT_FREE_SWAP_RETIRED`; the secret-drop
 *   redraft (`/api/drafts/[id]/redraft/**`) replaced it (draft-backend §8.1 #31).
 * - trade: admin-mediated two-sided swap. A `preview` returns the spend
 *   preview; a non-preview trade NO LONGER executes immediately — instead it
 *   creates a PENDING trade request and returns `pending: true` so both
 *   players must consent before the swap runs (see trade-request routes).
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<RedraftPreviewData | RedraftTradePendingData>>> {
  try {
    const { id } = await params;
    const player = await requirePlayer();

    const body = await request.json();
    const parsed = redraftExecuteSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // Free swaps are retired: the secret-drop redraft (`/api/drafts/[id]/redraft/**`) replaced
    // them (draft-backend §8.1 #31). Only admin-mediated trades remain here.
    if (parsed.data.transfer_type === 'free_swap') {
      return retiredResponse('REDRAFT_FREE_SWAP_RETIRED');
    }

    const { player_id, from_tracker_id, to_line_entry_id, trade_partner_id, preview } = parsed.data;

    // Only the player themselves or an admin can execute a redraft
    if (player.playerId !== player_id && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'You can only redraft your own lines', code: 'redraft_lines_not_own' },
        { status: 403 }
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
    if (!preview && !rules?.redraft_phase_open) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Redraft phase is not open for this season', code: 'redraft_phase_not_open' },
        { status: 403 }
      );
    }

    const listEntries = await getListEntries(season.point_buy_list_id);
    const toLine = listEntries.find((e) => e.id === to_line_entry_id);
    if (!toLine) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Target line not found in the bound point-buy list',
          code: 'redraft_target_line_not_in_list',
        },
        { status: 404 }
      );
    }

    // Server-computed remaining points (never trust the client)
    const budget = rules?.draft_budget ?? epbPack.defaults.draftBudget;
    const ratio = rules?.draft_token_ratio ?? epbPack.defaults.tokenRatio;
    const remainingPoints = await computeRemainingPoints(id, player_id, budget, ratio);

    // Trades move a second player's roster — admin-mediated only
    if (!player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Trades are executed by an admin on behalf of both players',
          code: 'trade_admin_only',
        },
        { status: 403 }
      );
    }
    if (!trade_partner_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'trade_partner_id is required for trades', code: 'trade_partner_required' },
        { status: 400 }
      );
    }

    // Two-sided swap: the target line must be owned by the partner, and
    // the partner receives the player's line in return. Both sides match by
    // line id, so the two branches of one base never get mixed up.
    const trackers = await getSeasonTrackers(id);
    const partnerTracker = trackers.find(
      (t) => t.player_id === trade_partner_id && trackerHoldsEntry(t, toLine)
    );
    if (!partnerTracker) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Target line is not owned by the trade partner', code: 'trade_target_not_partner_line' },
        { status: 400 }
      );
    }
    const fromTracker = trackers.find((t) => t.id === from_tracker_id);
    if (!fromTracker || fromTracker.player_id !== player_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Source tracker not found for this player', code: 'trade_source_tracker_missing' },
        { status: 404 }
      );
    }
    const fromEntry = entryForTracker(fromTracker, listEntries);
    if (!fromEntry) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'The offered line is not part of the bound point-buy list',
          code: 'trade_offered_line_not_in_list',
        },
        { status: 400 }
      );
    }

    const partnerRemaining = await computeRemainingPoints(id, trade_partner_id, budget, ratio);

    const [sideA, sideB] = await Promise.all([
      prepareRedraftSwap({
        season_id: id, player_id, from_tracker_id,
        to_line: toLine, transfer_type: 'trade',
        trade_partner_id, remaining_points: remainingPoints,
      }),
      prepareRedraftSwap({
        season_id: id, player_id: trade_partner_id, from_tracker_id: partnerTracker.id,
        to_line: fromEntry, transfer_type: 'trade',
        trade_partner_id: player_id, remaining_points: partnerRemaining,
      }),
    ]);
    if (!sideA.swap) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: sideA.error ?? 'Trade failed', ...refusalCode(sideA.refusal) },
        { status: 400 }
      );
    }
    if (!sideB.swap) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Trade partner side failed: ${sideB.error ?? 'validation error'}`,
          ...refusalCode(sideB.refusal),
        },
        { status: 400 }
      );
    }

    if (preview) {
      return NextResponse.json({
        success: true,
        data: {
          preview: {
            valid: true,
            points_spent: sideA.swap.points_spent,
            missing_kills_transferred: sideA.swap.payload.history.missing_kills_transferred,
            new_stage: sideA.swap.payload.new_tracker.current_stage,
            new_form: sideA.swap.payload.new_tracker.current_form,
            new_total_kos: sideA.swap.payload.new_tracker.total_kos,
            partner_points_spent: sideB.swap.points_spent,
          },
        },
      });
    }

    // Non-preview trades NO LONGER execute here. They create a PENDING
    // trade request and return `pending: true`; both players must consent
    // before the swap runs (see /api/seasons/[id]/redraft/trade-request).
    // This guarantees no admin path can bypass consent. TradeConsentError
    // extends UserFacingError — the outer safeErrorResponse passes its
    // message + status through.
    const tradeRequest = await createPendingTradeRequest(id, player.playerId, {
      sideA: {
        player_id: player_id,
        from_tracker_id: fromTracker.id,
        line: fromTracker.base_pokemon,
        entry: fromEntry,
      },
      sideB: {
        player_id: trade_partner_id,
        from_tracker_id: partnerTracker.id,
        line: partnerTracker.base_pokemon,
        entry: toLine,
      },
    });
    // The design keeps this handler's expiry (§8.1 #31, write-route-tags REQUIRED); the
    // rosters change only on consent, which expires the reads again.
    expireDraftReads(id);

    return NextResponse.json({
      success: true,
      data: {
        pending: true,
        trade_request: tradeRequest,
        message: 'Trade initiated — awaiting consent from both players',
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to execute redraft');
  }
}
