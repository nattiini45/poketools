import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { applyAdjustment } from '@/lib/format-engine/runtime/adjust';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import {
  ADJUSTMENT_BODY_MAX_BYTES,
  adjustmentBody,
  adjustmentListQuery,
  toAdjustmentInput,
  type AdjustmentBody,
} from '@/lib/format-engine/runtime/api-schemas';
import { noStore } from '@/lib/format-engine/runtime/http';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { REFUSAL_OF_ISSUE, refuse } from '@/lib/format-engine/runtime/refusal';
import { loadAdjustmentsPage } from '@/lib/format-engine/runtime/views-server';
import type { AdjustmentCreated, AdjustmentsPage } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { ADJUST_LIMIT, ADMIN_READ_LIMIT } from '../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * What the audit entry records of an adjustment: ids, keys and counts only. The reason lives in `format_adjustments`;
 * link pairs (a hidden giver/receiver mapping), domain entries and the item of a resource adjustment (what a player was
 * granted or lost, possibly a secret gift) are never copied into the audit log: every site admin reads it, and one may
 * face that player. The resource key, the player and the amount stay.
 */
function auditTarget(adjustment: AdjustmentBody['adjustment']): Record<string, string | number | boolean | null> {
  switch (adjustment.kind) {
    case 'points':
      return { stage: adjustment.stage, player_id: adjustment.player_id };
    case 'rank':
      return { stage: adjustment.stage, players: adjustment.order.length };
    case 'resource':
      return { resource: adjustment.resource, player_id: adjustment.player_id, amount: adjustment.amount };
    case 'relation':
      return { relation: adjustment.relation, reveal: adjustment.reveal === true, draw: adjustment.draw === true, link_count: adjustment.links?.length ?? 0 };
    case 'action':
      return { action: adjustment.action, state: adjustment.state };
    case 'domain':
      return { domain: adjustment.domain, added: adjustment.add?.length ?? 0, removed: adjustment.remove?.length ?? 0 };
  }
}

/**
 * GET /api/seasons/[id]/format/adjustments?limit=&offset=
 *
 * League admin (or site admin). The adjustment kinds the format allows, the form targets (player, stage, resource,
 * relation and action ids and labels; no link pairs) and a page of the history, newest first. A league that does not run
 * a kit format still pages its history. Never cached.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const seasonId = id.toLowerCase();

    const rate = await checkRateLimit(ADMIN_READ_LIMIT.bucket, admin.playerId, ADMIN_READ_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const search = new URL(request.url).searchParams;
    const query = adjustmentListQuery.safeParse({
      ...(search.has('limit') ? { limit: search.get('limit') } : {}),
      ...(search.has('offset') ? { offset: search.get('offset') } : {}),
    });
    if (!query.success) return validationFailedResponse(query.error);

    const ctx = await loadFreshKitContext(seasonId);
    const page = await loadAdjustmentsPage(seasonId, ctx, query.data, admin.playerId);
    return NextResponse.json<ApiResult<AdjustmentsPage>>({ success: true, data: page }, noStore());
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the adjustments');
  }
}

/**
 * POST /api/seasons/[id]/format/adjustments
 *
 * League admin (or site admin). Applies ONE manual adjustment (points, rank, resource, relation, action or domain; the
 * record-only `outcome` is not accepted) in one transaction. The format must allow the kind in an `adjust.manual` rule,
 * `reason` is required (at most 500 characters), and the library checks the change against the roster, the holdings and
 * the relation shape. A refused change throws its `format_adjust_*` / `format_not_running` code. The limiter fails closed
 * (503). The library expires the league reads. The league comes from the URL only.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const seasonId = id.toLowerCase();

    const rate = await checkRateLimit(ADJUST_LIMIT.bucket, admin.playerId, ADJUST_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = adjustmentBody.safeParse(await readBoundedJson(request, ADJUSTMENT_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);
    const { reason, adjustment } = parsed.data;

    const result = await applyAdjustment({
      seasonId,
      adminId: admin.playerId,
      reason,
      adjustment: toAdjustmentInput(adjustment),
    });
    if (!result.ok) throw refuse(REFUSAL_OF_ISSUE[result.issue]);

    logAuditEvent({
      action: 'season.format.adjustment',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: {
        adjustment_id: result.id,
        kind: adjustment.kind,
        target: auditTarget(adjustment),
        reason_length: Array.from(reason).length,
      },
    });

    return NextResponse.json<ApiResult<AdjustmentCreated>>({ success: true, data: { adjustment_id: result.id } }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to apply the adjustment');
  }
}
