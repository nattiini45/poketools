import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { startDraftSchema } from '@/lib/draft/schemas';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** The body is optional: empty → `{}`; malformed JSON → `null` (a 400 from the schema). */
async function optionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * POST /api/drafts/[id]/start — start an initial queue-engine draft (draft-backend §8.1 #4).
 *
 * Body: `{}`. `draft_start` generates the snake queue, activates the first
 * slot and logs `draft_started` in `draft_action_log` (actor + new state).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    startDraftSchema.parse(await optionalJsonBody(request));

    const pool = await getQueuePool(id);
    const result = await callDraftRpc<{ state_version: number }>('draft_start', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
    });
    expireDraftReads(pool.season_id);
    // The active slot may have changed: claim its Discord turn ping after the response.
    scheduleDraftNotifications(pool.id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to start the draft');
  }
}
