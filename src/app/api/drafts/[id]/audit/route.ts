import { NextResponse, type NextRequest } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { auditQueryInput, auditQuerySchema } from '@/lib/draft/schemas';
import { listDraftAudit, type DraftAuditPage } from '@/lib/supabase/queries/drafts-audit';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/drafts/[id]/audit?action=&player=&cursor=&limit= — the pool's audit
 * trail for pool admins, newest first, including non-public rows.
 *
 * `action` is repeatable (`DRAFT_AUDIT_ACTIONS`), `limit` 1..200 (default 50),
 * `cursor` = the previous page's `next_cursor`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireDraftAdmin(id);
    const query = auditQuerySchema.parse(auditQueryInput(request.nextUrl.searchParams));

    const pool = await getQueuePool(id);
    const page = await listDraftAudit({
      poolId: pool.id,
      actions: query.action,
      playerId: query.player,
      cursor: query.cursor,
      limit: query.limit,
    });

    return NextResponse.json<ApiResult<DraftAuditPage>>({ success: true, data: page });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to load the draft audit log');
  }
}
