import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import type { DeleteRebuildWarning } from '@/lib/api/delete-rebuild-warning';
import { logAuditEvent } from '@/lib/audit/log';
import { leagueTrashUserError, toLeagueTrashError } from '@/lib/league-trash/errors';
import { LeagueTrashDbError } from '@/lib/league-trash/db-error';
import { finishLeagueDeleteRebuild, finishLeagueRestoreRebuild } from '@/lib/league-trash/service';
import { getPendingLeagueRebuild } from '@/lib/supabase/queries/league-trash';
import { expirePublicTags, expireRatingReads, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

// A delete rebuild rebuilds all-time statistics globally and a restore rebuild settles ratings in passes.
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** The body `data` of a pending-rebuild run. */
export interface LeagueRebuildRunResult {
  /** Which rebuild ran: the one after a delete, or the one after a restore. */
  kind: 'delete' | 'restore';
  /** Null when the rebuild finished and was confirmed; otherwise it stays pending. */
  rebuild_warning: DeleteRebuildWarning | null;
}

/**
 * POST /api/admin/league-trash/[id]/rebuild: runs the derived-data rebuild a league delete or restore left pending
 * (superadmin only; `id` is the trash id both kinds of pending rebuild carry). The pending list is the trash page's.
 * The rebuild steps are idempotent, so running it again after a failure is
 * safe. 404 `LEAGUE_TRASH_NOT_FOUND` when nothing is pending for the id.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireSuperadmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_LEAGUE_TRASH_ID');
    if (invalidId) return invalidId;

    const pending = await getPendingLeagueRebuild(id);
    if (!pending) throw leagueTrashUserError(new LeagueTrashDbError('LEAGUE_TRASH_NOT_FOUND'));

    const outcome =
      pending.kind === 'delete'
        ? await finishLeagueDeleteRebuild({
            trashId: pending.trash_id,
            seasonId: pending.season_id,
            playerIds: pending.player_ids,
            phaseIds: pending.phase_ids,
          })
        : await finishLeagueRestoreRebuild({ seasonId: pending.season_id, playerIds: pending.player_ids });
    // The rebuild changed the aggregates (league, phases, all-time) and the players' ratings.
    expirePublicTags([
      publicTags.aggregates('league', pending.season_id),
      publicTags.aggregates('all_time', null),
      ...pending.phase_ids.map((phaseId) => publicTags.aggregates('tournament', phaseId)),
    ]);
    expireRatingReads(pending.player_ids);

    logAuditEvent({
      action: 'season.rebuild',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: pending.season_id,
      resource_name: pending.season_name,
      metadata: {
        trash_id: pending.trash_id,
        kind: pending.kind,
        rebuild: outcome.summary,
        rebuild_error: outcome.warning?.code ?? null,
      },
    });
    return NextResponse.json<ApiResult<LeagueRebuildRunResult>>({
      success: true,
      data: { kind: pending.kind, rebuild_warning: outcome.warning },
    });
  } catch (error) {
    return safeErrorResponse(toLeagueTrashError(error) ?? error, 'Failed to run the pending rebuild');
  }
}
