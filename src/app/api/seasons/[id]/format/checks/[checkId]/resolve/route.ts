import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { logAuditEvent } from '@/lib/audit/log';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { readBoundedJson } from '@/lib/format-engine/runtime/api-body';
import { checkResolveBody, SMALL_BODY_MAX_BYTES } from '@/lib/format-engine/runtime/api-schemas';
import { resolveCheck } from '@/lib/format-engine/runtime/checks-server';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import type { CheckResolved } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { getFormatCheck } from '@/lib/supabase/queries/format-runtime-reads';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { CHECK_RESOLVE_LIMIT } from '../../../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string; checkId: string }>;
}

/**
 * POST /api/seasons/[id]/format/checks/[checkId]/resolve
 *
 * League admin (or site admin). Confirms or rejects one OPEN check of this league with an optional note (blank = none).
 * It records the admin's verdict only; it has no effect on the engine. A check of another league is 404
 * `format_check_not_found`; one that is no longer open (including a lost race) is 409 `format_check_not_open`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, checkId } = await params;
    const admin = await requireResourceAdmin('season', id);
    const seasonId = id.toLowerCase();

    const invalid = rejectInvalidPathId(checkId, 'INVALID_CHECK_ID');
    if (invalid) return invalid;

    const rate = await checkRateLimit(CHECK_RESOLVE_LIMIT.bucket, admin.playerId, CHECK_RESOLVE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = checkResolveBody.safeParse(await readBoundedJson(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) return validationFailedResponse(parsed.error);

    // One season-scoped read: it supplies the 404 / 409 split and the source and rule id of the audit entry.
    const normalisedCheckId = checkId.toLowerCase();
    const check = await getFormatCheck(seasonId, normalisedCheckId);
    if (check === null) throw refuse('format_check_not_found');
    if (check.status !== 'open') throw refuse('format_check_not_open');

    const note = parsed.data.note === undefined || parsed.data.note === '' ? null : parsed.data.note;
    const resolved = await resolveCheck({
      seasonId,
      checkId: normalisedCheckId,
      status: parsed.data.verdict,
      adminId: admin.playerId,
      note,
    });
    if (!resolved) throw refuse('format_check_not_open');

    logAuditEvent({
      action: 'season.format.check.resolve',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: seasonId,
      metadata: { check_id: normalisedCheckId, verdict: parsed.data.verdict, source: check.source, rule_id: check.rule_id },
    });

    return NextResponse.json<ApiResult<CheckResolved>>({
      success: true,
      data: { check_id: normalisedCheckId, state: parsed.data.verdict },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resolve the check');
  }
}
