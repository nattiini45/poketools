import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { seasonUpdateSchema, formatZodErrors } from '@/lib/validation';
import { z } from 'zod';
import { getSeasonWithDetails, updateSeason, deleteSeason, getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { archiveTournamentsBySeason } from '@/lib/supabase/queries/tournaments';
import { bindSeasonToList } from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import {
  rebuildAfterSeasonDelete,
  type EntityDeleteRebuildSummary,
} from '@/lib/reconcile/entity-delete-rebuild';
import { expireSeasonReads } from '@/lib/revalidation';
import {
  toDeleteRebuildWarning,
  toTestFlagRebuildWarning,
  testFlagRebuildUnsettledWarning,
  type DeleteRebuildWarning,
  type EntityDeleteResult,
} from '@/lib/api/delete-rebuild-warning';
import {
  rebuildRatingsAfterTestFlagChange,
  type TestFlagRatingRebuildSummary,
} from '@/lib/rating/test-league-rebuild';
import type { ApiResult } from '@/types/api';
import type { Season, SeasonWithDetails } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// The DELETE handler rebuilds all derived data (aggregates, ratings, streaks)
// after the cascade, and a PATCH of the test-league flag rebuilds the league
// players' ratings — allow long-running rebuilds.
export const maxDuration = 300;

/**
 * The body `data` of a PATCH: the updated league, plus what setting the
 * test-league flag did to ratings. `rating_rebuild` is null when the flag was
 * not sent; `rebuild_warning` is set (and `rating_rebuild` null) when the flag
 * was saved but the rebuild after it failed, and set next to the summary when
 * the rebuild ran to its pass cap unsettled (`test_flag_rating_rebuild_unsettled`).
 */
export type SeasonUpdateResult = Season & {
  rating_rebuild: TestFlagRatingRebuildSummary | null;
  rebuild_warning: DeleteRebuildWarning | null;
};

// Public
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const season = await getSeasonWithDetails(id);
    if (!season) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }
    return NextResponse.json<ApiResult<SeasonWithDetails>>({
      success: true,
      data: season,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch league');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const zodResult = seasonUpdateSchema
      .extend({ archived: z.boolean().optional(), is_test_season: z.boolean().optional() })
      .safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // `language` (the league's content language, i18n-core §6.1) passes
    // through to `updateSeason` with the other settings.
    const body = zodResult.data;

    // The test-league flag is site-admin only (checked before any write): it
    // badges the league in every public list, keeps its matches out of player
    // ratings and the games recorded from then on out of the all-time stats.
    // League admins edit the rest.
    if (body.is_test_season !== undefined && !admin.isAdmin) {
      throw new UserFacingError('Only site admins can change the test-league flag', {
        code: 'season_test_flag_site_admin_only',
        status: 403,
      });
    }
    // The flag before the write, for the audit record's `changed`.
    const flagBefore = body.is_test_season !== undefined ? (await getSeasonById(id))?.is_test_season ?? null : null;

    // Point-buy list binding goes through the guarded helper: only upcoming
    // seasons may switch versions (running seasons keep their snapshot), and
    // the binding is audit-logged.
    if (body.point_buy_list_id !== undefined && body.point_buy_list_id !== null) {
      await bindSeasonToList(id, body.point_buy_list_id);
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'season.bind_point_buy_list',
        resource_type: 'season',
        resource_id: id,
        metadata: { point_buy_list_id: body.point_buy_list_id },
      });
      delete body.point_buy_list_id;
    }

    const season = await updateSeason(id, body);
    if (body.archived !== undefined) {
      await archiveTournamentsBySeason(id, body.archived);
    }
    // Expires the league's own reads and the season list, so a flipped
    // test flag shows (or hides the league) on the next public view.
    expireSeasonReads(id);

    // Test leagues stay out of ratings, by the CURRENT flag: every request
    // that sends the flag rebuilds the league players' ratings for the stored
    // value, changed or not (src/lib/rating/test-league-rebuild.ts, which also
    // expires their rating reads). A request cut off after the save leaves a
    // partial rebuild, and sending the flag again finishes it. The flag is
    // already saved, so a failed rebuild must not read as a failed save: the
    // response carries it as `rebuild_warning` (the admin runs the reconcile
    // repair), and the server log and the audit record keep it. A rebuild that
    // ran to its pass cap unsettled is reported the same way, with its summary.
    let ratingRebuild: TestFlagRatingRebuildSummary | null = null;
    let rebuildWarning: DeleteRebuildWarning | null = null;
    if (body.is_test_season !== undefined) {
      try {
        ratingRebuild = await rebuildRatingsAfterTestFlagChange(id, season.is_test_season);
        if (!ratingRebuild.settled) {
          console.error(
            `test-league flag of league ${id}: rating rebuild not settled after ${ratingRebuild.passes} passes`
          );
          rebuildWarning = testFlagRebuildUnsettledWarning();
        }
      } catch (err) {
        console.error(`test-league flag of league ${id}: rating rebuild failed:`, err);
        rebuildWarning = toTestFlagRebuildWarning(err);
      }
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'season.set_test_flag',
        resource_type: 'season',
        resource_id: id,
        resource_name: season.name,
        metadata: {
          is_test_season: body.is_test_season,
          changed: flagBefore !== null && flagBefore !== season.is_test_season,
          // Counts only: the player lists of a large league do not belong in every audit row.
          rating_rebuild: ratingRebuild
            ? {
                players: ratingRebuild.playerIds.length,
                rebuilt: ratingRebuild.rebuiltPlayerIds.length,
                passes: ratingRebuild.passes,
                settled: ratingRebuild.settled,
                unrated_matches: ratingRebuild.unratedMatches,
              }
            : null,
          rating_rebuild_error: rebuildWarning?.code ?? null,
        },
      });
    }
    return NextResponse.json<ApiResult<SeasonUpdateResult>>({
      success: true,
      data: { ...season, rating_rebuild: ratingRebuild, rebuild_warning: rebuildWarning },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update league');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const season = await getSeasonById(id);
    // Capture participants BEFORE the delete: the cascade removes the
    // participant rows, and they define whose ratings/streaks must be rebuilt.
    const participants = await getSeasonParticipants(id);
    await deleteSeason(id);
    expireSeasonReads(id);

    // Rebuild derived data built from the deleted season's matches. The
    // delete has already committed, so a rebuild failure must not read as a
    // failed delete: the response carries it as `rebuild_warning` (the admin
    // runs the reconcile repair), and the server log and audit record keep it.
    let rebuild: EntityDeleteRebuildSummary | null = null;
    let rebuildWarning: DeleteRebuildWarning | null = null;
    try {
      rebuild = await rebuildAfterSeasonDelete({
        seasonId: id,
        playerIds: participants.map((p) => p.id),
      });
    } catch (err) {
      console.error('season delete derived-data rebuild failed:', err);
      // Reported to the admin in the response (catalogued code, e.g.
      // rating_history_incomplete) and kept in the audit record.
      rebuildWarning = toDeleteRebuildWarning(err);
    }

    logAuditEvent({
      action: 'season.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: id,
      resource_name: season?.name ?? id,
      metadata: { rebuild, rebuild_error: rebuildWarning?.code ?? null },
    });
    return NextResponse.json<ApiResult<EntityDeleteResult>>({
      success: true,
      data: { rebuild_warning: rebuildWarning },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete league');
  }
}
