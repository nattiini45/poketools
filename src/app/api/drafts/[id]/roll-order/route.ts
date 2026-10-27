import { NextResponse } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { logAuditEvent } from '@/lib/audit/log';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { poolRosterIds } from '@/lib/draft/pool-roster';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { rollOrderSchema } from '@/lib/draft/schemas';
import { drawSeatOrder } from '@/lib/draft/seat-draw';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** The body is optional: empty → `{}`; malformed JSON → the catalogued `400 invalid_json` (as `readJsonBody`). */
async function optionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    console.error('[api/drafts/roll-order] malformed JSON body:', err);
    throw new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 400 });
  }
}

/**
 * POST /api/drafts/[id]/roll-order — draw a new opening order for an Initial queue draft (draft admins only).
 *
 * Body: `{}`. The server shuffles the pool's roster (the season's participants, or a league group's members) with
 * a cryptographic RNG (`drawSeatOrder`) and seats them through the existing `draft_configure` (seats only). The RPC
 * enforces setup-only (`DRAFT_ALREADY_STARTED` otherwise), checks the seat set and logs `seats_changed` with the
 * previous and the new seats; the roll is also audited as `draft.order.roll`. Every call draws again. Rounds 1 and 2
 * run from the drawn order when the draft starts (forward, then reversed); `draft_start` draws the later pairs of
 * rounds itself. A Redraft is seated by standings, never drawn.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    rollOrderSchema.parse(await optionalJsonBody(request));

    const pool = await getQueuePool(id);
    if (pool.kind !== 'initial') throw new DraftRuleError('INVALID_CONFIG', { field: 'participant_order' });

    const order = drawSeatOrder(await poolRosterIds(pool));
    const seats = order.map((player_id, index) => ({ player_id, seat: index + 1 }));

    const result = await callDraftRpc<{ state_version: number }>('draft_configure', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
      p_patch: {},
      p_seats: seats,
    });
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'draft.order.roll',
      resource_type: 'draft_pool',
      resource_id: pool.id,
      metadata: { season_id: pool.season_id, season_group_id: pool.season_group_id ?? null, seats: order.length },
    });
    expireDraftReads(pool.season_id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to roll the draft order');
  }
}
