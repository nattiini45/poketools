import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { extensionSchema } from '@/lib/draft/schemas';
import { applyDraftExtension, getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/drafts/[id]/extensions — use the +120 s or +60 s extension on the
 * viewer's own active pick (draft-backend §8.1 #10; live drafts only).
 *
 * Body: `{ kind: 'plus120' | 'plus60', slot_id }`. The RPC re-checks turn,
 * pause, slot and the once-per-draft rule under the pool lock. No public read
 * shows deadlines (route-tag EXEMPT).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    // The path id first (malformed or missing → 404 POOL_NOT_FOUND), then the body (400).
    await getQueuePool(id);
    const body = extensionSchema.parse(await request.json());

    const result = await applyDraftExtension({
      poolId: id,
      playerId: player.playerId,
      kind: body.kind,
      slotId: body.slot_id,
    });

    return NextResponse.json<ApiResult<{ deadline_at: string; state_version: number }>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to extend the pick clock');
  }
}
