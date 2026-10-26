import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import type { DeleteRebuildWarning } from '@/lib/api/delete-rebuild-warning';
import { logAuditEvent } from '@/lib/audit/log';
import { toLeagueTrashError } from '@/lib/league-trash/errors';
import type { LeagueTrashRestoreWarning } from '@/lib/league-trash/restore-warnings';
import { finishLeagueRestoreRebuild } from '@/lib/league-trash/service';
import { restoreLeagueFromTrash } from '@/lib/supabase/queries/league-trash';
import { expirePublicTags, expireRatingReads, expireSeasonReads, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

// The restore itself is one database call; the rebuild after it (rating settle passes, streaks, the aggregate queue)
// can take minutes for a big league.
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** The body `data` of a restore. */
export interface LeagueRestoreResult {
  season_id: string;
  season_name: string;
  /** Queue drafts that came back paused: an admin resumes them from the league's draft panel. */
  paused_pools: number;
  /** Things the restore did that the superadmin should read (outside rows that lost their parent, ignored columns, ...). */
  warnings: LeagueTrashRestoreWarning[];
  /** Null when the rebuild after the restore finished. Otherwise the rebuild stays pending on the trash page. */
  rebuild_warning: DeleteRebuildWarning | null;
}

/**
 * POST /api/admin/league-trash/[id]/restore: brings a deleted league back from the trash (superadmin only).
 *
 * One database transaction re-inserts the league's rows with their ids, moves every running deadline by the time the
 * league spent in the trash, comes back with its running drafts paused and queues its games for the aggregate worker;
 * nothing is restored when anything fails. The rebuild after it (aggregate queue, ratings, streaks, EPB repair) is
 * confirmed to the database; a failure of it is a `rebuild_warning` next to a successful restore. A deleted league
 * whose own delete rebuild is still pending is refused by the database (409 `LEAGUE_TRASH_REBUILD_PENDING`): its
 * statistics would be counted twice.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireSuperadmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_LEAGUE_TRASH_ID');
    if (invalidId) return invalidId;

    const restored = await restoreLeagueFromTrash(id);
    // The league is back in every read: its own tag, its phases' tags, the lists and the profiles.
    expireSeasonReads(restored.season_id, restored.phase_ids);

    const { summary: rebuild, warning: rebuildWarning } = await finishLeagueRestoreRebuild({
      seasonId: restored.season_id,
      playerIds: restored.player_ids,
    });
    // The rebuild counted the games into the aggregates (league, phases, all-time) and rewrote ratings and streaks.
    expirePublicTags([
      publicTags.aggregates('league', restored.season_id),
      publicTags.aggregates('all_time', null),
      ...restored.phase_ids.map((phaseId) => publicTags.aggregates('tournament', phaseId)),
    ]);
    expireRatingReads(restored.player_ids);

    logAuditEvent({
      action: 'season.restore',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: restored.season_id,
      resource_name: restored.season_name,
      metadata: {
        trash_id: id,
        restored: restored.restored,
        shift_seconds: restored.shift_seconds,
        paused_pools: restored.paused_pools,
        queued_aggregate_jobs: restored.queued_aggregate_jobs,
        schema_version_at_delete: restored.schema_version_at_delete,
        warnings: restored.warnings,
        rebuild,
        rebuild_error: rebuildWarning?.code ?? null,
      },
    });
    return NextResponse.json<ApiResult<LeagueRestoreResult>>({
      success: true,
      data: {
        season_id: restored.season_id,
        season_name: restored.season_name,
        paused_pools: restored.paused_pools,
        warnings: restored.warnings,
        rebuild_warning: rebuildWarning,
      },
    });
  } catch (error) {
    return safeErrorResponse(toLeagueTrashError(error) ?? error, 'Failed to restore league');
  }
}
