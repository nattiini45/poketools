import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { epbPack } from '@/lib/format-pack';
import { getRedraftEligibleLines } from '@/lib/draft/redraft-engine';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { retiredResponse } from '../tokens/_lib/retired';
import type { ApiResult } from '@/types/api';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

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
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

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

/**
 * POST /api/seasons/[id]/redraft: RETIRED, reads and writes nothing.
 * Every call answers `410 REDRAFT_TRADE_RETIRED`: trades were abolished for
 * Evolution Point Buy (migration 20261018140300_epb_retire_trades cancelled
 * pending requests and dropped the execute RPC; `redraft_trade_requests` stays
 * as a read-only archive), and the former free swap was replaced by the
 * secret-drop redraft (`/api/drafts/[id]/redraft/**`).
 *
 * The body is never read or parsed, so an empty or malformed body cannot turn
 * the retired answer into a 500. Authentication still comes first, so an
 * anonymous caller gets 401, not 410.
 */
export async function POST(
  _request: NextRequest,
): Promise<NextResponse<ApiResult<never>>> {
  try {
    await requirePlayer();
    return retiredResponse('REDRAFT_TRADE_RETIRED');
  } catch (err) {
    return safeErrorResponse(err, 'Failed to answer the retired redraft endpoint');
  }
}
