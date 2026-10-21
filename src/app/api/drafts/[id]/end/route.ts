import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { endDraftSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/drafts/[id]/end — abort a draft (draft-backend §8.1 #5, §6.3). No slot
 * is ever forfeited (the pool always stays completable, so a draft only ends by
 * completing or by an abort):
 *   - a redraft still in its submission phase is cancelled;
 *   - a running initial draft is aborted: every pick is voided (a line with
 *     progress refuses with VOID_BLOCKED_PROGRESS), the open queue is discarded
 *     and the pool is cancelled, so it can be deleted and drafted again;
 *   - a running redraft cannot be aborted (DRAFT_ABORT_NOT_ALLOWED).
 *
 * Body: `{ reason }` (3..500). `draft_end` logs `draft_cancelled` with the reason.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    const body = endDraftSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const result = await callDraftRpc<{ state_version: number }>('draft_end', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
      p_reason: body.reason,
    });
    expireDraftReads(pool.season_id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to end the draft');
  }
}
