import { NextRequest, NextResponse } from 'next/server';
import { requireDraftAdmin, requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import {
  getDraftPoolById,
  getDraftPoolWithDetails,
  updateDraftPoolStatus,
  deleteDraftPool,
} from '@/lib/supabase/queries/drafts';
import { uuidSchema } from '@/lib/draft/schemas';
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
 * (use /start, /end, /pause instead).
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

    const pool = await updateDraftPoolStatus(id, body.status);
    expireDraftReads(pool.season_id);
    return NextResponse.json<ApiResult<DraftPool>>({ success: true, data: pool });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update draft pool');
  }
}

/** SQLSTATE 23503: the only non-cascading FK into draft_pools is a redraft's parent_pool_id. */
function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503';
}

/** Queue-engine phases in which a pool may still be deleted (design decision). */
const DELETABLE_QUEUE_PHASES: ReadonlySet<DraftPhase> = new Set<DraftPhase>(['setup', 'cancelled']);

/**
 * DELETE /api/drafts/[id] — delete a pending draft pool (admin only)
 * Queue-engine pools: only in phase `setup` or `cancelled`; any other phase
 * answers `409 POOL_NOT_DELETABLE` with `detail.phase` (machine data, never
 * rendered: a raw phase code has no German text) — cancel the draft first.
 * Legacy pools keep the pending-only rule of `deleteDraftPool`, which also
 * re-checks the queue rule.
 * A pool that a redraft pool still points at (`parent_pool_id`, no ON DELETE
 * action) fails the DELETE with SQLSTATE 23503; that answers `409 POOL_HAS_REDRAFT`.
 * The catch uses `draftErrorResponse` so `detail.phase` reaches the client.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireDraftAdmin(id);
    // Read first: the league it belonged to is expired after the delete.
    const pool = await getDraftPoolById(id);
    if (pool?.engine === 'queue' && !DELETABLE_QUEUE_PHASES.has(pool.phase)) {
      throw new DraftRuleError('POOL_NOT_DELETABLE', undefined, { phase: pool.phase });
    }
    try {
      await deleteDraftPool(id);
    } catch (deleteErr) {
      if (isForeignKeyViolation(deleteErr)) throw new DraftRuleError('POOL_HAS_REDRAFT');
      throw deleteErr;
    }
    if (pool) expireDraftReads(pool.season_id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to delete draft pool');
  }
}
