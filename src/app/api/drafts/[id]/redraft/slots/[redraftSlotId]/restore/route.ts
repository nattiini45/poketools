import { NextResponse } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { restoreDropSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; redraftSlotId: string }>;
}

/**
 * POST /api/drafts/[id]/redraft/slots/[redraftSlotId]/restore — undo one
 * published drop while the redraft draft is paused (draft-backend §8.1 #23,
 * §6.8).
 *
 * Body: `{ reason }`. `redraft_admin_restore_drop` brings the tracker back
 * from its snapshot, removes the slot and its refund, shrinks the player's
 * roster by removing one of their queue slots (nothing is forfeited), refuses
 * a restore that would leave the pool uncompletable (POOL_NOT_COMPLETABLE /
 * POOL_CHECK_LIMIT) and logs `drop_restored` with the before/after state. The
 * `secret_drop` history row stays as audit.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, redraftSlotId } = await params;
    const admin = await requireDraftAdmin(id);
    const invalidRedraftSlotId = rejectInvalidPathId(redraftSlotId, 'INVALID_REDRAFT_SLOT_ID');
    if (invalidRedraftSlotId) return invalidRedraftSlotId;
    const body = restoreDropSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const result = await callDraftRpc<{ state_version: number }>('redraft_admin_restore_drop', {
      p_pool_id: pool.id,
      p_redraft_slot_id: redraftSlotId,
      p_actor_id: admin.playerId,
      p_reason: body.reason,
    });
    expireDraftReads(pool.season_id);
    // The active slot may have changed: claim its Discord turn ping after the response.
    scheduleDraftNotifications(pool.id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to restore the redraft drop');
  }
}
