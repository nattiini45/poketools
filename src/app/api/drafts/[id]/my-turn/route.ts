import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { uuidSchema } from '@/lib/draft/schemas';
import { toMyTurnDTO } from '@/lib/draft/snapshot';
import { expireDraftReads } from '@/lib/revalidation';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import type { ApiResult } from '@/types/api';
import type { MyTurnDTO } from '@/types/draft-queue';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/drafts/[id]/my-turn — the hidden-tab turn watch (draft-backend §8.1 #8, §11.1).
 *
 * The only draft endpoint polled while the tab is hidden (every 60 s, AGENTS.md
 * D37 exception): one guard read and one `draft_my_turn` RPC per quiet tick.
 * The RPC itself refuses an unknown pool (`POOL_NOT_FOUND`) and a legacy pool
 * (`POOL_ENGINE_LEGACY`), so no pool read precedes it. The RPC ticks, so it can
 * publish a redraft: only then is the pool read, for its season, and the draft
 * reads expired (critique B8). A publish or a resolved timeout (a new slot may
 * be active) schedules the Discord notification claim after the response; a
 * plain poll never does (Supabase quota). `published_now` /
 * `timeouts_resolved` never reach the response.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    // A malformed id is a missing pool, not a database error.
    if (!uuidSchema.safeParse(id).success) throw new DraftRuleError('POOL_NOT_FOUND');

    const raw = await callDraftRpc<unknown>('draft_my_turn', { p_pool_id: id, p_player_id: player.playerId });
    const { dto, publishedNow, timeoutsResolved } = toMyTurnDTO(raw);
    if (publishedNow) {
      // The publish is committed: a failing season lookup is logged, never the answer.
      try {
        const pool = await getDraftPoolById(id);
        if (pool) expireDraftReads(pool.season_id);
      } catch (err) {
        console.error('[api/drafts/my-turn] pool read after a published redraft failed:', err);
      }
    }
    if (publishedNow || timeoutsResolved > 0) scheduleDraftNotifications(id);

    return NextResponse.json<ApiResult<MyTurnDTO>>({ success: true, data: dto });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to check the draft turn');
  }
}
