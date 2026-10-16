import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { spendComebackTokens } from '@/lib/draft/progress-engine';
import { toDraftRuleError } from '@/lib/draft/rpc-errors';
import { comebackSpendSchema } from '@/lib/draft/schemas';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { buildTokenOverview, getEpbSeason, loadTokenSeasonContext, readJsonBody } from '../../tokens/_lib/overview';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/comeback-tokens/spend — spend Comeback Tokens on the player's own lines
 * (draft-backend §8.1 #27, §6.9, BR-5).
 *
 * Body `{ allocations: [{ line_id, count 1..20 }] (1..9 lines), client_request_id }`. Comeback
 * Tokens are earned by shutout losses and may be spent once the redraft is complete or the admin
 * opened spending; unlike a Draft Kill Token they may evolve a line, so the stages are re-resolved
 * right after the spend. `epb_spend_comeback_tokens` re-checks the window (`COMEBACK_NOT_YET`),
 * the balance (`COMEBACK_BALANCE_SHORT`) and ownership under the season lock. Players spend only
 * their own tokens. Responds with the player's fresh `TokenOverviewDTO`.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const body = comebackSpendSchema.parse(await readJsonBody(request));

    const season = await getEpbSeason(id);
    try {
      await spendComebackTokens(id, player.playerId, body.allocations, body.client_request_id, player.playerId);
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
    return draftErrorResponse(err, 'Failed to spend Comeback Tokens');
  }
}
