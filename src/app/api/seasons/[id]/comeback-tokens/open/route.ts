import { NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { comebackOpenSchema } from '@/lib/draft/schemas';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { getEpbSeason, readJsonBody } from '../../tokens/_lib/overview';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ComebackOpenResult {
  open: boolean;
}

/**
 * POST /api/seasons/[id]/comeback-tokens/open — season admins open (or close) Comeback Token
 * spending for a league without a completed redraft (draft-backend §8.1 #28, §6.9; tokens are earned in the first half only).
 *
 * Body `{ open: boolean }`. `epb_set_comeback_spend_open` writes `format_rules.comeback_spend_open`
 * and logs the change; a league without format rules answers `INVALID_CONFIG {field}`.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const body = comebackOpenSchema.parse(await readJsonBody(request));

    await getEpbSeason(id);
    await callDraftRpc('epb_set_comeback_spend_open', {
      p_season_id: id,
      p_actor_id: admin.playerId,
      p_open: body.open,
    });
    expireSeasonReads(id);

    return NextResponse.json<ApiResult<ComebackOpenResult>>({ success: true, data: { open: body.open } });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to change Comeback Token spending');
  }
}
