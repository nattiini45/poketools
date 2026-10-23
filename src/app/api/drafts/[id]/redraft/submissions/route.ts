import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import { listRedraftSubmissions } from '@/lib/supabase/queries/drafts-redraft';
import { getPublishRefusedAt } from '@/lib/supabase/queries/draft-publish-refusals';
import type { ApiResult } from '@/types/api';
import type { AdminRedraftSubmissionsDTO } from '@/types/draft-queue';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/drafts/[id]/redraft/submissions — every participant's SECRET drop
 * list, for the pool admin only, plus
 * `publish_refused_at` (`draft_pools.publish_refused_at`: the deadline tick
 * refused to publish this Redraft; null = never), which the room's admin sheet
 * shows on its Redraft tab. The guard runs before any read; players without a
 * submission are not listed. A malformed pool id is a 404 `POOL_NOT_FOUND`
 * from `requireDraftAdmin`, before any pool read.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireDraftAdmin(id);

    const pool = await getQueuePool(id);
    if (pool.kind !== 'redraft') throw new DraftRuleError('DRAFT_NOT_ACTIVE');

    const [submissions, publishRefusedAt] = await Promise.all([
      listRedraftSubmissions(pool.id),
      getPublishRefusedAt(pool.id),
    ]);
    return NextResponse.json<ApiResult<AdminRedraftSubmissionsDTO>>({
      success: true,
      data: { submissions, publish_refused_at: publishRefusedAt },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to load the redraft submissions');
  }
}
