import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSeasonTrackers, getTrackerById, applyTrackerProgressWithLog } from '@/lib/supabase/queries/evolutions';
import { getLatestProgressEntry } from '@/lib/supabase/queries/progress-log';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { assertEpbSeason } from '@/lib/season/format-utils';
import { recheckEpbStages } from '@/lib/match/evolution-match-evaluator';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { EvoProgressEntry, EvolutionTracker } from '@/types/evolution';
import { progressCorrectionSchema } from '@/lib/validation/schemas';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/seasons/[id]/progress?player_id=X
 * Get evolution progress for all trackers in a season (optionally filtered by player).
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<EvolutionTracker[]>>> {
  try {
    await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    // Format gate: progress trackers with source breakdown are EPB-only
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('player_id');

    const trackers = await getSeasonTrackers(id);
    const filtered = playerId
      ? trackers.filter((t) => t.player_id === playerId)
      : trackers;

    return NextResponse.json({ success: true, data: filtered });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch progress');
  }
}

/**
 * POST /api/seasons/[id]/progress
 * Admin correction: apply progress to a tracker. Resource admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<EvoProgressEntry>>> {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    // Format gate: legacy evo-league trackers must never hit the EPB
    // total_kos recompute (it would erase their battle-derived progress)
    const season = await getSeasonById(id);
    assertEpbSeason(season);

    const body = await request.json();
    const parsed = progressCorrectionSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { tracker_id, source, amount, note } = parsed.data;

    // Ownership check: the tracker must belong to the season the admin is
    // authorized for — otherwise a resource admin of season A could modify
    // trackers in season B by crafting the tracker_id.
    const tracker = await getTrackerById(tracker_id);
    if (!tracker || tracker.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tracker not found in this season', code: 'progress_tracker_not_in_season' },
        { status: 404 }
      );
    }

    // Apply the correction — tracker update + audit log in one transaction
    await applyTrackerProgressWithLog(tracker_id, source, amount, {
      note: note ?? 'Admin correction',
      createdBy: admin.playerId,
    });

    // Corrections can change the cumulative total: re-resolve the player's
    // stages and persist any transition as a manual development event
    await recheckEpbStages(id, [tracker.player_id], { isManual: true });
    expireSeasonReads(id);

    const entry = await getLatestProgressEntry(tracker_id);
    if (!entry) {
      // The RPC committed the log row; a missing read-back is unexpected
      console.error(`Progress correction applied but log entry not found for tracker ${tracker_id}`);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Correction applied but audit entry could not be read back', code: 'progress_audit_unreadable' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to apply progress correction');
  }
}
