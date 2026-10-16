import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { freeOrderSchema, uuidSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getDraftPoolById, switchDraftPoolToFreeOrder } from '@/lib/supabase/queries/drafts';
import type { ApiResult } from '@/types/api';
import type { DraftPool } from '@/types/draft';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Why a legacy pool cannot switch: the pool as read, or as re-read after a lost race. */
function refusal(pool: DraftPool | null): Error {
  if (!pool) return new UserFacingError('Draft pool not found', { code: 'POOL_NOT_FOUND', status: 404 });
  // EvoLiga (queue engine) drafts always run in snake order from their slots; pick_order means nothing there.
  if (pool.engine === 'queue') return new DraftRuleError('INVALID_CONFIG', { field: 'pick_order' });
  if (pool.pick_order === 'free') {
    return new UserFacingError('This draft already uses free order', { code: 'draft_free_order_already_free', status: 409 });
  }
  return new UserFacingError('Only a running draft can switch to free order', {
    code: 'draft_free_order_not_running',
    status: 409,
  });
}

/**
 * POST /api/drafts/[id]/free-order — switch a running legacy draft from snake/linear order to free order
 * (draft admins only). The admin escape for a stalled draft: with fixed prices in turn order the current picker can
 * be left unable to afford any pick that completes their roster, and nobody else may pick. Free order checks no
 * turn: everyone else picks on, the stuck player picks what they can afford, and an admin ends the draft
 * (`PATCH /api/drafts/[id]` status `complete`) when nothing is left to pick. Picks, budgets and the seat order are
 * untouched; there is no switch back (free-order picks follow no turn, so the turn count would no longer fit).
 *
 * Body: `{ reason? }` (≤ 500), written to the audit log with the old order.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    const body = freeOrderSchema.parse(await request.json());

    // A malformed id is a missing pool, not a database error.
    const pool = uuidSchema.safeParse(id).success ? await getDraftPoolById(id) : null;
    if (!pool || pool.engine !== 'legacy' || pool.status !== 'in_progress' || pool.pick_order === 'free') {
      throw refusal(pool);
    }

    const updated = await switchDraftPoolToFreeOrder(id);
    if (!updated) throw refusal(await getDraftPoolById(id));

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'draft.pick_order.free',
      resource_type: 'draft_pool',
      resource_id: id,
      metadata: {
        season_id: pool.season_id,
        from: pool.pick_order,
        to: 'free',
        reason: body.reason !== undefined && body.reason !== '' ? body.reason : null,
      },
    });
    // The league page shows the pool's order.
    expireDraftReads(pool.season_id);

    return NextResponse.json<ApiResult<DraftPool>>({ success: true, data: updated });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to switch the draft to free order');
  }
}
