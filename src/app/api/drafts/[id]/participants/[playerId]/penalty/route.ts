import { NextResponse } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { penaltySchema } from '@/lib/draft/schemas';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; playerId: string }>;
}

/**
 * POST /api/drafts/[id]/participants/[playerId]/penalty — set a slow-draft
 * penalty stage.
 *
 * Body: `{ stage: 0..5, reason }`; the RPC narrows `stage` to the pool's
 * ladder (`INVALID_CONFIG {field:'stage'}`) and logs `penalty_changed` with the
 * previous and new stage. Only the uncached state poll shows penalty stages
 * (route-tag EXEMPT).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, playerId } = await params;
    const admin = await requireDraftAdmin(id);
    const invalidPlayerId = rejectInvalidPathId(playerId, 'INVALID_PLAYER_ID');
    if (invalidPlayerId) return invalidPlayerId;
    const targetId = playerId;
    const body = penaltySchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const result = await callDraftRpc<{ state_version: number }>('draft_admin_set_penalty', {
      p_pool_id: pool.id,
      p_player_id: targetId,
      p_stage: body.stage,
      p_actor_id: admin.playerId,
      p_reason: body.reason,
    });

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to change the penalty stage');
  }
}
