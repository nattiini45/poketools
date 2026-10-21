import { NextRequest, NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { DraftRuleError } from '@/lib/draft/errors';
import { uuidSchema } from '@/lib/draft/schemas';
import { undoLastPick, getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { isEvoLeague } from '@/lib/draft/evolution-engine';
import { deleteTrackerById, deleteTrackerByLine, getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { expireDraftReads } from '@/lib/revalidation';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Removes the tracker of an undone pick, branch-exact: by the pick's line id
 * (every legacy EPB pick stores it since R-API). An older pick without one
 * resolves the player's trackers on that base: the undone pick is the
 * player's latest on this base, so its tracker is the newest one there, and
 * that exact row goes by id (both branches of one base may belong to the
 * same player, so a base-keyed delete is never used).
 */
async function deleteUndoneTracker(
  seasonId: string,
  undone: { player_id: string; pokemon_name: string; line_id: string | null },
): Promise<void> {
  if (undone.line_id) {
    await deleteTrackerByLine(seasonId, undone.player_id, undone.line_id);
    return;
  }
  const onBase = (await getPlayerTrackers(seasonId, undone.player_id)).filter(
    (t) => t.base_pokemon === undone.pokemon_name,
  );
  if (onBase.length === 0) return;
  const newest = onBase.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  await deleteTrackerById(newest.id);
}

/**
 * POST /api/drafts/[id]/undo — undo the last pick (admin only; legacy pools).
 *
 * Queue-engine pools answer `409 USE_VOID_PICK`: they correct picks with the
 * audited void/correct routes (draft-backend §8.1 #24). Legacy failures carry
 * an `errors/draft` code next to their unchanged English text (§9.2).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireDraftAdmin(id);

    // A malformed id never reaches the database (L10).
    const idResult = uuidSchema.safeParse(id);
    if (!idResult.success) {
      const issues = formatZodErrors(idResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const pool = await getDraftPoolById(id);
    if (!pool) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Draft pool not found', code: 'POOL_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (pool.engine === 'queue') throw new DraftRuleError('USE_VOID_PICK');

    if (pool.status !== 'in_progress') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Can only undo picks in an active draft', code: 'UNDO_NOT_ACTIVE' },
        { status: 400 }
      );
    }

    const undone = await undoLastPick(id);

    // Clean up evolution tracker if this was an evo-league pick
    if (await isEvoLeague(pool.season_id)) {
      await deleteUndoneTracker(pool.season_id, undone);
    }
    expireDraftReads(pool.season_id);

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to undo pick');
  }
}
