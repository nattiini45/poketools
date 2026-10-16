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
 * POST /api/drafts/[id]/end — end a running draft early, or cancel a redraft
 * still in its submission phase (draft-backend §8.1 #5, §6.3).
 *
 * Body: `{ reason }` (3..500). Open slots are forfeited; `draft_end` logs
 * `draft_ended` / `draft_cancelled` with the reason.
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
