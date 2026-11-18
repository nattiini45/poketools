import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { authorizeCorrectionTarget } from '../reset/correction-target';
import { formatZodErrors, matchHistoryQuerySchema } from '@/lib/validation';
import { listMatchAuditEvents } from '@/lib/audit/queries';
import type { MatchHistoryPage } from '@/lib/admin/match-detail';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/matches/[id]/history?offset=0&limit=20 — one page of the
 * audit events of a match and its games, newest first. The ip address never
 * leaves the server.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await authorizeCorrectionTarget(params);
    if (!access.ok) return access.response;

    const search = request.nextUrl.searchParams;
    const query: Record<string, string> = {};
    for (const key of ['offset', 'limit']) {
      const value = search.get(key);
      if (value !== null) query[key] = value;
    }
    const parsed = matchHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { id, kind } = access.target;
    const page = await listMatchAuditEvents(id, parsed.data, kind);
    return NextResponse.json<ApiResult<MatchHistoryPage>>({ success: true, data: page });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the match history');
  }
}
