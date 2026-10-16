import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { purchaseDraftKillToken } from '@/lib/draft/progress-engine';
import { toDraftRuleError } from '@/lib/draft/rpc-errors';
import { draftKillTokenPurchaseSchema } from '@/lib/draft/schemas';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { buildTokenOverview, getEpbSeason, loadTokenSeasonContext, readJsonBody } from '../tokens/_lib/overview';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/draft-kill-tokens — buy ONE Draft Kill Token for one of the player's
 * own lines (draft-backend §8.1 #26, §6.9, BR-4).
 *
 * Body `{ line_id, client_request_id }`. A Draft Kill Token costs `draft_token_ratio` unspent
 * points and adds +1 progress; at most `draft_token_max` per player and `draft_token_max_per_line`
 * per line; it never triggers an evolution; the points never come back. Every rule is re-checked by `epb_purchase_draft_token` under the season lock and comes
 * back as its `errors/draft` code (`TOKEN_WINDOW_CLOSED`, `TOKEN_PLAYER_LIMIT`, ...). A repeated
 * `client_request_id` replays the first purchase. Players buy only for themselves.
 * Responds with the player's fresh `TokenOverviewDTO`.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const body = draftKillTokenPurchaseSchema.parse(await readJsonBody(request));

    const season = await getEpbSeason(id);
    try {
      await purchaseDraftKillToken(id, player.playerId, body.line_id, body.client_request_id, player.playerId);
    } catch (err) {
      throw toDraftRuleError(err) ?? err;
    }
    expireSeasonReads(id);

    const ctx = await loadTokenSeasonContext(season, player.playerId);
    return NextResponse.json<ApiResult<TokenOverviewDTO>>({
      success: true,
      data: buildTokenOverview(ctx, player.playerId, new Date()),
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to buy a Draft Kill Token');
  }
}
