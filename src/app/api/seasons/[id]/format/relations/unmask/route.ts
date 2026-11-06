import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEventStrict } from '@/lib/audit/log';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { readBoundedJsonOrEmpty } from '@/lib/format-engine/runtime/api-body';
import { SMALL_BODY_MAX_BYTES, unmaskBody } from '@/lib/format-engine/runtime/api-schemas';
import { noStore } from '@/lib/format-engine/runtime/http';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { loadUnmasked } from '@/lib/format-engine/runtime/views-server';
import type { AdminUnmasked } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { ADMIN_READ_LIMIT } from '../../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/seasons/[id]/format/relations/unmask
 *
 * League admin (or site admin). The explicit, audited read of the hidden relation sides: every relation with both sides
 * and, per action, the state and target of each current participant (never the picks). A POST because it has a side
 * effect (the audit entry); a GET could be fired by a link or a prefetch. The panel's default view stays masked, so an
 * admin who also plays is not shown their own game. Never cached.
 *
 * Fail-closed: the audit entry is written and AWAITED (`logAuditEventStrict`) BEFORE the body is returned, and the
 * body is only built into a response once that write succeeded. When the write fails the answer is a 503 with no data
 * (a read without its audit row is not allowed to happen). The entry names the relations, never a pair.
 * 409 `format_not_running` when the league does not run a kit format, 503 when the audit entry could not be written.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const seasonId = id.toLowerCase();

    const rate = await checkRateLimit(ADMIN_READ_LIMIT.bucket, admin.playerId, ADMIN_READ_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = unmaskBody.safeParse(await readBoundedJsonOrEmpty(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    const ctx = await loadFreshKitContext(seasonId);
    if (ctx === null) throw refuse('format_not_running');
    const unmasked = await loadUnmasked(ctx, admin.playerId);

    try {
      await logAuditEventStrict({
        action: 'season.format.relations.view_hidden',
        actor_id: admin.playerId,
        actor_name: admin.name,
        resource_type: 'season',
        resource_id: seasonId,
        metadata: { relations: unmasked.relations.map((relation) => relation.key) },
      });
    } catch (auditError) {
      // No audit row, no data: `unmasked` is dropped here and the generic 503 carries nothing from it.
      return safeErrorResponse(auditError, 'The hidden relations could not be shown because the read could not be recorded', 503);
    }

    return NextResponse.json<ApiResult<AdminUnmasked>>({ success: true, data: unmasked }, noStore());
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the hidden relations');
  }
}
