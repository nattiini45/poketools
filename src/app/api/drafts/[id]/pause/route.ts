import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { pauseDraftSchema } from '@/lib/draft/schemas';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/drafts/[id]/pause — pause or resume the pick clock (draft-backend
 * §8.1 #6; every mode, BR-16; the redraft submission phase has no clock).
 *
 * Body: `{ paused, reason? }`. `draft_set_paused` logs `paused` / `resumed`
 * with the remaining time. No cached public read shows the pause state
 * (route-tag EXEMPT): it is read only from the uncached state poll. A resume
 * schedules the Discord notification claim (the turn ping of a slot that was
 * activated while paused).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    const body = pauseDraftSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const reason = body.reason !== undefined && body.reason !== '' ? body.reason : null;
    const result = await callDraftRpc<{ state_version: number }>('draft_set_paused', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
      p_paused: body.paused,
      p_reason: reason,
    });
    // A resume restarts the clock: the active slot's turn ping goes out now if it was never sent.
    if (!body.paused) scheduleDraftNotifications(pool.id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to change the draft pause');
  }
}
