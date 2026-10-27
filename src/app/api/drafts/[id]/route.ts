import { NextRequest, NextResponse } from 'next/server';
import { requireDraftAdmin, requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import {
  getDraftPoolById,
  getDraftPoolWithDetails,
  updateDraftPoolStatus,
  deleteDraftPool,
} from '@/lib/supabase/queries/drafts';
import { uuidSchema } from '@/lib/draft/schemas';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { expireDraftReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { DraftPool, DraftPoolWithDetails } from '@/types/draft';
import type { DraftPhase } from '@/types/draft-queue';
import { draftPoolUpdateSchema, formatZodErrors } from '@/lib/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/drafts/[id] — get draft pool details
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requirePlayer();
    const { id } = await params;
    // A malformed id is a missing pool, not a database error (no Postgres round-trip).
    const pool = uuidSchema.safeParse(id).success ? await getDraftPoolWithDetails(id) : null;
    if (!pool) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Draft pool not found', code: 'POOL_NOT_FOUND' },
        { status: 404 }
      );
    }
    return NextResponse.json<ApiResult<DraftPoolWithDetails>>({ success: true, data: pool });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch draft pool');
  }
}

/**
 * PATCH /api/drafts/[id] — update draft pool status (admin only)
 * Body: { status: 'pending' | 'in_progress' | 'complete' }
 * Legacy pools only: a queue-engine pool answers `422 INVALID_CONFIG {field:'status'}`
 * (use /start, /end, /pause instead). A legacy pool of a point-buy season is never
 * activated: `in_progress` answers `409 POOL_ENGINE_LEGACY_EPB`, because its picks would
 * bypass the queue engine's completability gate (docs/draft-room.md, "Completability").
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireDraftAdmin(id);
    const rawBody = await request.json();
    const zodResult = draftPoolUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    // Queue-engine pools move through phases only via their RPC routes (start/end/void);
    // a bare status write would leave phase and status disagreeing.
    const current = await getDraftPoolById(id);
    if (current?.engine === 'queue') throw new DraftRuleError('INVALID_CONFIG', { field: 'status' });
    if (current && body.status === 'in_progress') {
      const season = await getSeasonById(current.season_id);
      if (season && isEvolutionPointBuy(season.format_type)) throw new DraftRuleError('POOL_ENGINE_LEGACY_EPB');
    }

    const pool = await updateDraftPoolStatus(id, body.status);
    expireDraftReads(pool.season_id);
    return NextResponse.json<ApiResult<DraftPool>>({ success: true, data: pool });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update draft pool');
  }
}

/**
 * The refusing (no ON DELETE action) foreign keys into `draft_pools`, by constraint name, and the
 * catalogued code each maps to. Every other FK into draft_pools cascades or sets null
 * (draft_picks, draft_slots, draft_participants, ... cascade; redraft_history sets null).
 */
const REFUSING_POOL_FKS: Readonly<Record<string, 'POOL_HAS_REDRAFT' | 'POOL_HAS_TEAMS'>> = {
  draft_pools_parent_pool_id_fkey: 'POOL_HAS_REDRAFT',
  fk_teams_draft_pool: 'POOL_HAS_TEAMS',
};

/**
 * The catalogued code of a SQLSTATE 23503 (foreign_key_violation) from the pool DELETE, keyed on the
 * constraint name Postgres puts in the message (`... violates foreign key constraint "<name>" on
 * table ...`). Null for anything else, including a 23503 from an unknown constraint: that one
 * propagates unmapped instead of being reported as the wrong refusal.
 */
function refusingPoolFkCode(err: unknown): 'POOL_HAS_REDRAFT' | 'POOL_HAS_TEAMS' | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (code !== '23503' || typeof message !== 'string') return null;
  const constraint = /foreign key constraint "([^"]+)"/.exec(message)?.[1];
  return constraint && Object.prototype.hasOwnProperty.call(REFUSING_POOL_FKS, constraint)
    ? REFUSING_POOL_FKS[constraint]
    : null;
}

/** Queue-engine phases in which a pool may still be deleted (design decision). */
const DELETABLE_QUEUE_PHASES: ReadonlySet<DraftPhase> = new Set<DraftPhase>(['setup', 'cancelled']);

/**
 * DELETE /api/drafts/[id] — delete a pending draft pool (admin only)
 * Queue-engine pools: only in phase `setup` or `cancelled`; any other phase
 * answers `409 POOL_NOT_DELETABLE` with `detail.phase` (machine data, never
 * rendered: a raw phase code has no German text) — cancel the draft first.
 * Legacy pools keep the pending-only rule of `deleteDraftPool`, which also
 * re-checks the queue rule. The queue DELETE itself filters on the phase, so a Start that lands between the read
 * and the DELETE answers the same 409 instead of deleting a started draft.
 * A successful delete is audited as `draft.pool.delete` (who deleted which pool, in which phase).
 * Two foreign keys into draft_pools have no ON DELETE action and refuse the DELETE with
 * SQLSTATE 23503: a redraft pool's `parent_pool_id` answers `409 POOL_HAS_REDRAFT`, a team's
 * `draft_pool_id` (`fk_teams_draft_pool`) answers `409 POOL_HAS_TEAMS`. The rows of the
 * cascading children (picks, slots, participants, ...) are deleted with the pool.
 * The catch uses `draftErrorResponse` so `detail.phase` reaches the client.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    // Read first: the league it belonged to is expired after the delete.
    const pool = await getDraftPoolById(id);
    if (pool?.engine === 'queue' && !DELETABLE_QUEUE_PHASES.has(pool.phase)) {
      throw new DraftRuleError('POOL_NOT_DELETABLE', undefined, { phase: pool.phase });
    }
    try {
      await deleteDraftPool(id);
    } catch (deleteErr) {
      const refusal = refusingPoolFkCode(deleteErr);
      if (refusal) throw new DraftRuleError(refusal);
      throw deleteErr;
    }
    if (pool) {
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'draft.pool.delete',
        resource_type: 'draft_pool',
        resource_id: id,
        metadata: {
          season_id: pool.season_id,
          season_group_id: pool.season_group_id ?? null,
          phase: pool.phase,
          kind: pool.kind,
        },
      });
      expireDraftReads(pool.season_id);
    }
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to delete draft pool');
  }
}
