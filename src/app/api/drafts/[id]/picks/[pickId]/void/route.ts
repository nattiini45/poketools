import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { uuidSchema, voidPickSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; pickId: string }>;
}

/**
 * POST /api/drafts/[id]/picks/[pickId]/void — void a pick (draft-backend §8.1
 * #11, BR-8). The draft must be paused (or complete).
 *
 * Body: `{ reason, requeue }`. `requeue: true` gives the player a fresh pick
 * directly before the current one; `false` records the opportunity as
 * forfeited. Budget, roster and availability are restored by the RPC, which
 * logs `pick_voided` with the voided pick row (before) and the restored slot
 * (after).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, pickId } = await params;
    const admin = await requireDraftAdmin(id);
    const targetPickId = uuidSchema.parse(pickId);
    const body = voidPickSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const result = await callDraftRpc<{ state_version: number }>('draft_admin_void_pick', {
      p_pool_id: pool.id,
      p_pick_id: targetPickId,
      p_actor_id: admin.playerId,
      p_reason: body.reason,
      p_requeue: body.requeue,
      p_replacement_line_id: null,
      p_replacement_thresholds: null,
      p_client_request_id: null,
    });
    expireDraftReads(pool.season_id);
    // The active slot may have changed: claim its Discord turn ping after the response.
    scheduleDraftNotifications(pool.id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to void the pick');
  }
}
