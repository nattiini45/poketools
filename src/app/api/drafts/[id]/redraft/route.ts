import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { redraftPatchSchema } from '@/lib/draft/schemas';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import { redraftSeatsFromOrder } from '@/lib/supabase/queries/drafts-redraft';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/drafts/[id]/redraft — move the submission deadline, change the
 * max drops or the redraft order before publish. The
 * submission phase has no clock to pause; moving the deadline is its "pause"
 * (BR-16). There is no `open` field (CRIT B6).
 *
 * Body (strict): `{ deadline_at?, redraft_max_lines?, participant_order? }`.
 * `draft_configure` accepts redraft changes only in the submission phase
 * (`DRAFT_ALREADY_STARTED` otherwise) and logs `draft_configured` /
 * `seats_changed`. The deadline and order are read only from the uncached
 * state poll (route-tag EXEMPT).
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    const body = redraftPatchSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    if (pool.kind !== 'redraft') throw new DraftRuleError('DRAFT_NOT_ACTIVE');

    const patch: Record<string, string | number> = {};
    if (body.deadline_at !== undefined) patch.submission_deadline_at = body.deadline_at;
    if (body.redraft_max_lines !== undefined) patch.redraft_max_lines = body.redraft_max_lines;
    const seats = body.participant_order ? await redraftSeatsFromOrder(pool.season_id, body.participant_order, pool.season_group_id ?? null) : null;

    const result = await callDraftRpc<{ state_version: number }>('draft_configure', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
      p_patch: patch,
      p_seats: seats,
    });

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to update the redraft');
  }
}
