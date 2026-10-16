import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import { listRedraftSubmissions } from '@/lib/supabase/queries/drafts-redraft';
import type { ApiResult } from '@/types/api';
import type { AdminSubmissionDTO } from '@/types/draft-queue';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/drafts/[id]/redraft/submissions — every participant's SECRET drop
 * list, for the pool admin only (draft-backend §8.1 #20, §10.4). The guard
 * runs before any read; players without a submission are not listed.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireDraftAdmin(id);

    const pool = await getQueuePool(id);
    if (pool.kind !== 'redraft') throw new DraftRuleError('DRAFT_NOT_ACTIVE');

    const submissions = await listRedraftSubmissions(pool.id);
    return NextResponse.json<ApiResult<AdminSubmissionDTO[]>>({ success: true, data: submissions });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to load the redraft submissions');
  }
}
