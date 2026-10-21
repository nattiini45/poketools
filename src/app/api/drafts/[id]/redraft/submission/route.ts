import { NextRequest, NextResponse } from 'next/server';
import { requireDraftAdmin, requirePlayer } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { redraftSubmissionQuerySchema, redraftSubmissionSchema } from '@/lib/draft/schemas';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import {
  buildRedraftSubmissionDTO,
  isPoolParticipant,
  type OwnSubmission,
} from '@/lib/supabase/queries/drafts-redraft';
import type { ApiResult } from '@/types/api';
import type { DraftPool } from '@/types/draft';
import type { RedraftSubmissionDTO } from '@/types/draft-queue';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** A queue-engine redraft pool; an initial pool has no submissions (`DRAFT_NOT_ACTIVE`, as in M6). */
async function getRedraftPool(id: string): Promise<DraftPool> {
  const pool = await getQueuePool(id);
  if (pool.kind !== 'redraft') throw new DraftRuleError('DRAFT_NOT_ACTIVE');
  return pool;
}

/**
 * GET /api/drafts/[id]/redraft/submission[?player_id=] — the SECRET drop list
 * of ONE player (draft-backend §8.1 #18, §10.4).
 *
 * Without `player_id` (or with the viewer's own id) the viewer reads their own
 * list. Another player's list needs the pool admin guard (403 otherwise):
 * submissions stay secret until publish (SPEC:696-699). Every read is filtered
 * by that one player id; nothing here is cached.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const player = await requirePlayer();
    const query = redraftSubmissionQuerySchema.parse({
      player_id: request.nextUrl.searchParams.get('player_id') ?? undefined,
    });

    const targetId = query.player_id ?? player.playerId;
    if (targetId !== player.playerId) await requireDraftAdmin(id);

    const pool = await getRedraftPool(id);
    if (!(await isPoolParticipant(pool.id, targetId))) throw new DraftRuleError('NOT_PARTICIPANT');

    const dto = await buildRedraftSubmissionDTO(pool, targetId);
    return NextResponse.json<ApiResult<RedraftSubmissionDTO>>({ success: true, data: dto });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to load the redraft submission');
  }
}

/**
 * PUT /api/drafts/[id]/redraft/submission — replace the viewer's own SECRET
 * drop list (draft-backend §8.1 #19, §6.8). Withdraw = `line_ids: []`.
 *
 * Own list only: the body has no `player_id`, and admins cannot submit for
 * others (`redraft_set_submission` also refuses `ACTOR_NOT_ALLOWED`). The RPC
 * checks the phase/deadline, the participant, the max and every line (owned,
 * not `no_redraft`). No public read changes until publish, so no tag is
 * expired (route-tag EXEMPT).
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const player = await requirePlayer();
    // The path id first (malformed or missing → 404 POOL_NOT_FOUND), then the body (400).
    const pool = await getRedraftPool(id);
    const body = redraftSubmissionSchema.parse(await request.json());

    const raw = await callDraftRpc<{ line_ids?: unknown; updated_at?: unknown } | null>('redraft_set_submission', {
      p_pool_id: pool.id,
      p_player_id: player.playerId,
      p_actor_id: player.playerId,
      p_actor_role: 'player',
      p_line_ids: body.line_ids,
    });
    const saved: OwnSubmission = {
      line_ids: Array.isArray(raw?.line_ids)
        ? raw.line_ids.filter((l): l is string => typeof l === 'string')
        : [...new Set(body.line_ids)].sort(),
      updated_at: typeof raw?.updated_at === 'string' ? raw.updated_at : null,
    };

    const dto = await buildRedraftSubmissionDTO(pool, player.playerId, saved);
    return NextResponse.json<ApiResult<RedraftSubmissionDTO>>({ success: true, data: dto });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to save the redraft submission');
  }
}
