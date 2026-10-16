import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { effectiveThresholds, type EffectiveThresholds } from '@/lib/draft/line-catalog-data';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { resolveSlotSchema, uuidSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import { getListEntryByLineId } from '@/lib/supabase/queries/point-buy-lists';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; slotId: string }>;
}

/**
 * POST /api/drafts/[id]/slots/[slotId]/resolve — resolve the current blocked
 * pick (draft-backend §8.1 #13, §6.5).
 *
 * Body: `{ action: 'assign', line_id, reason, client_request_id, redraft_slot_id?, resume? }`
 * (an admin pick for the blocked player: budget bypass; availability and
 * restrictions still apply) or `{ action: 'forfeit', reason, resume? }`.
 * `resume` (default true) restarts the clock when no blocked pick remains.
 * The RPC logs `slot_assigned` / `slot_forfeited` (and `resumed`) with the
 * admin actor and the reason.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, slotId } = await params;
    const admin = await requireDraftAdmin(id);
    const targetSlotId = uuidSchema.parse(slotId);
    const body = resolveSlotSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const assign = body.action === 'assign' ? body : null;

    // Redraft picks transfer kills at the new line's (override-aware) thresholds; SQL needs them passed in.
    let thresholds: EffectiveThresholds | null = null;
    if (assign && pool.kind === 'redraft') {
      if (!pool.list_version_id) throw new DraftRuleError('SEASON_HAS_NO_LIST');
      const entry = await getListEntryByLineId(pool.list_version_id, assign.line_id);
      if (!entry) throw new DraftRuleError('NOT_IN_LIST');
      thresholds = effectiveThresholds(entry);
    }

    const result = await callDraftRpc<{ state_version: number }>('draft_admin_resolve_slot', {
      p_pool_id: pool.id,
      p_slot_id: targetSlotId,
      p_actor_id: admin.playerId,
      p_action: body.action,
      p_line_id: assign?.line_id ?? null,
      p_reason: body.reason,
      p_client_request_id: assign?.client_request_id ?? null,
      p_redraft_slot_id: assign?.redraft_slot_id ?? null,
      p_line_thresholds: thresholds,
      p_resume: body.resume,
    });
    expireDraftReads(pool.season_id);
    // The active slot may have changed: claim its Discord turn ping after the response.
    scheduleDraftNotifications(pool.id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to resolve the blocked pick');
  }
}
