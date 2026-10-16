import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { effectiveThresholds, type EffectiveThresholds } from '@/lib/draft/line-catalog-data';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { correctPickSchema, uuidSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import { getListEntryByLineId } from '@/lib/supabase/queries/point-buy-lists';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; pickId: string }>;
}

/**
 * POST /api/drafts/[id]/picks/[pickId]/correct — replace a pick with another
 * line (draft-backend §8.1 #12): void + requeue + an immediate admin pick in
 * one RPC transaction. The draft must be paused (or complete).
 *
 * Body: `{ line_id, reason, client_request_id, redraft_slot_id? }`;
 * `client_request_id` is required (critique B6), so a retried correction
 * replays instead of picking twice. The RPC logs `pick_voided` and
 * `pick_corrected` (admin actor, before/after, reason). The replacement fills
 * the voided pick's own redraft slot: a `redraft_slot_id` in the body is
 * accepted by the schema, but the RPC keeps the original slot.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, pickId } = await params;
    const admin = await requireDraftAdmin(id);
    const targetPickId = uuidSchema.parse(pickId);
    const body = correctPickSchema.parse(await request.json());

    const pool = await getQueuePool(id);

    // Redraft picks transfer kills at the new line's (override-aware) thresholds; SQL needs them passed in.
    let thresholds: EffectiveThresholds | null = null;
    if (pool.kind === 'redraft') {
      if (!pool.list_version_id) throw new DraftRuleError('SEASON_HAS_NO_LIST');
      const entry = await getListEntryByLineId(pool.list_version_id, body.line_id);
      if (!entry) throw new DraftRuleError('NOT_IN_LIST');
      thresholds = effectiveThresholds(entry);
    }

    const result = await callDraftRpc<{ state_version: number }>('draft_admin_void_pick', {
      p_pool_id: pool.id,
      p_pick_id: targetPickId,
      p_actor_id: admin.playerId,
      p_reason: body.reason,
      p_requeue: true,
      p_replacement_line_id: body.line_id,
      p_replacement_thresholds: thresholds,
      p_client_request_id: body.client_request_id,
    });
    expireDraftReads(pool.season_id);
    // The active slot may have changed: claim its Discord turn ping after the response.
    scheduleDraftNotifications(pool.id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to correct the pick');
  }
}
