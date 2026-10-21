import { after, NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { dispatchDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { redraftPublishSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PublishResult {
  state_version: number;
  drops: number;
}

/**
 * POST /api/drafts/[id]/redraft/publish — reveal every secret drop at once
 * and start the redraft queue (draft-backend §8.1 #22, §6.8; BR-9).
 *
 * Body: `{ force?, reason? }`. Before the deadline only `force: true` with a
 * reason publishes (`SUBMISSIONS_NOT_DUE` / `OVERRIDE_REASON_REQUIRED`); at the
 * deadline the cron and the state poll publish on their own. A publish whose
 * redraft could not fill every slot is refused and rolled back
 * (`REDRAFT_NOT_COMPLETABLE` {slots, lines}, or `POOL_CHECK_LIMIT`): the
 * submissions stay secret, and moving the deadline lets the players change them. On success the
 * draft reads are expired and, after the response, the `redraft_published`
 * (and first turn) notifications are claimed and sent exactly once.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    const body = redraftPublishSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    const result = await callDraftRpc<PublishResult>('redraft_publish', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
      p_force: body.force ?? false,
      p_reason: body.reason ?? null,
    });
    expireDraftReads(pool.season_id);

    after(async () => {
      // Awaited inside after() so the reads finish before the function is frozen; the posts are fire-and-forget.
      try {
        await dispatchDraftNotifications(await callDraftRpc('draft_claim_notifications', { p_pool_id: pool.id }));
      } catch (err) {
        console.error('[api/drafts/redraft/publish] claiming draft notifications failed:', err);
      }
    });

    return NextResponse.json<ApiResult<PublishResult>>({
      success: true,
      data: { state_version: result.state_version, drops: result.drops },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to publish the redraft');
  }
}
