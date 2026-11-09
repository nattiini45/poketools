import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { checkListQuery } from '@/lib/format-engine/runtime/api-schemas';
import { noStore } from '@/lib/format-engine/runtime/http';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { loadChecksPage } from '@/lib/format-engine/runtime/views-server';
import type { ChecksPage } from '@/lib/format-engine/runtime/view-types';
import { validationFailedResponse } from '@/lib/format-studio/api-schemas';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { ADMIN_READ_LIMIT } from '../_lib/limits';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/seasons/[id]/format/checks?status=open|confirmed|rejected|all&limit=&offset=
 *
 * League admin (or site admin). A page of the league's checks, newest first, with the rule label resolved from the
 * format when the league runs one (without it the labels are null and the list still works). A check's `subject` is
 * admin-only and is returned only here; the waiting giver of a hidden relation is left out for an admin who plays, and the planned team behind a team review is left out for an admin who is not a site admin. `status` is a QUERY filter; the response members are `state`. Never cached.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const seasonId = id.toLowerCase();

    const rate = await checkRateLimit(ADMIN_READ_LIMIT.bucket, admin.playerId, ADMIN_READ_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const search = new URL(request.url).searchParams;
    const query = checkListQuery.safeParse({
      ...(search.has('status') ? { status: search.get('status') } : {}),
      ...(search.has('limit') ? { limit: search.get('limit') } : {}),
      ...(search.has('offset') ? { offset: search.get('offset') } : {}),
    });
    if (!query.success) return validationFailedResponse(query.error);

    const ctx = await loadFreshKitContext(seasonId);
    const page = await loadChecksPage(seasonId, ctx, query.data.status, { limit: query.data.limit, offset: query.data.offset }, admin.playerId, admin.isAdmin);
    return NextResponse.json<ApiResult<ChecksPage>>({ success: true, data: page }, noStore());
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the checks');
  }
}
