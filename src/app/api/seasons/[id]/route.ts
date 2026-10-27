import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { seasonUpdateSchema, formatZodErrors } from '@/lib/validation';
import { z } from 'zod';
import { getSeasonWithDetails, updateSeason, getSeasonById } from '@/lib/supabase/queries/seasons';
import { archiveTournamentsBySeason } from '@/lib/supabase/queries/tournaments';
import { bindSeasonToList } from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent, diffField } from '@/lib/audit/log';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import { assertFormatChangeAllowed, assertSeasonDateRange } from '@/lib/season/settings-guards';
import { isSeasonStarted } from '@/lib/season/season-started';
import { assertRulesetChangeAllowed } from '@/lib/ruleset-studio/pin-change';
import { finishLeagueDeleteRebuild, trashLeague } from '@/lib/league-trash/service';
import { toLeagueTrashError } from '@/lib/league-trash/errors';
import { expirePublicTags, expireRatingReads, expireSeasonReads, publicTags } from '@/lib/revalidation';
import { assertFormatTypeChangeAllowed } from '@/lib/format-studio/attach';
import {
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
// after the league moved to the trash, and a PATCH of the test-league flag
// rebuilds the league players' ratings — allow long-running rebuilds.
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

    // A switch to or from the custom type is refused once a format is attached or the league has started. A change
    // between the legacy types takes no extra read and no new refusal.
    if (body.format_type !== undefined) {
      await assertFormatTypeChangeAllowed(id, body.format_type);
    }

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

    // The league as stored, read once: the guards below compare the request
    // against it, and the audit record diffs it against the saved league.
    const before = await getSeasonById(id);
    if (!before) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'League not found', code: 'SEASON_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Date order is checked against the stored date when only one of the two
    // is sent (null clears one). A request that sends neither is not held to
    // a range a league already stored.
    if (body.start_date !== undefined || body.end_date !== undefined) {
      assertSeasonDateRange(
        body.start_date !== undefined ? body.start_date : before.start_date,
        body.end_date !== undefined ? body.end_date : before.end_date
      );
    }

    // The league type is locked once the league started and across the
    // point-buy boundary (src/lib/season/settings-guards.ts). Resending the
    // stored type passes, so the start signals are only read for a real change.
    // Nothing is written when a guard throws.
    if (body.format_type !== undefined && body.format_type !== before.format_type) {
      const phases = await getSeasonPhaseStartSignals(id);
      assertFormatChangeAllowed(before.format_type, body.format_type, {
        status: before.status,
        phases,
      });
    }

    // The league's default ruleset is a pin to an immutable version: a new value must be a ruleset the caller may use, and
    // once the league has started it moves only through the pin route (which asks for a confirmation). Resending the stored
    // value passes. Nothing is written when the guard throws.
    if (body.ruleset_id !== undefined && body.ruleset_id !== before.ruleset_id) {
      const phases = await getSeasonPhaseStartSignals(id);
      await assertRulesetChangeAllowed({
        player: admin,
        current: before.ruleset_id,
        requested: body.ruleset_id,
        started: isSeasonStarted({ status: before.status, phases }),
      });
    }

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

    // General settings audit. The test flag and the point-buy list binding
    // log their own events; the description is never copied into the row
    // (only that it changed).
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of [
      'name',
      'format_type',
      'ruleset_id',
      'start_date',
      'end_date',
      'status',
      'archived',
      'route_theme',
      'language',
    ] as const) {
      diffField(changes, field, before[field], season[field]);
    }
    const descriptionChanged = body.description !== undefined && body.description !== before.description;
    if (Object.keys(changes).length > 0 || descriptionChanged) {
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'season.update',
        resource_type: 'season',
        resource_id: id,
        resource_name: season.name,
        changes,
        metadata: descriptionChanged ? { description_changed: true } : undefined,
      });
    }

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
          changed: before.is_test_season !== season.is_test_season,
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

/**
 * DELETE /api/seasons/[id]: moves the league to the trash (`src/lib/league-trash`). Nothing blocks it: the database
 * function freezes running drafts, captures every row the league owns and deletes them in one transaction, and the
 * superadmin can restore the league until `purge_after` (`LEAGUE_TRASH_RETENTION_DAYS` days). The derived data built
 * from the league's matches is rebuilt afterwards; that rebuild is confirmed to the database, and a failure of it is
 * a `rebuild_warning` next to a successful delete (the superadmin runs it again from the trash page).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const trashed = await trashLeague(id, admin.playerId);
    // The league is gone from every read: its own tag, its phases' tags, the lists and the profiles.
    expireSeasonReads(id, trashed.phase_ids);

    const { summary: rebuild, warning: rebuildWarning } = await finishLeagueDeleteRebuild({
      trashId: trashed.trash_id,
      seasonId: id,
      playerIds: trashed.player_ids,
      phaseIds: trashed.phase_ids,
    });
    // The rebuild changed the aggregates (league, phases, all-time) and the participants' ratings.
    expirePublicTags([
      publicTags.aggregates('league', id),
      publicTags.aggregates('all_time', null),
      ...trashed.phase_ids.map((phaseId) => publicTags.aggregates('tournament', phaseId)),
    ]);
    expireRatingReads(trashed.player_ids);

    logAuditEvent({
      action: 'season.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: id,
      resource_name: trashed.season_name,
      metadata: {
        trash_id: trashed.trash_id,
        purge_after: trashed.purge_after,
        counts: trashed.counts,
        frozen_pools: trashed.frozen_pools,
        rebuild,
        rebuild_error: rebuildWarning?.code ?? null,
      },
    });
    return NextResponse.json<ApiResult<EntityDeleteResult>>({
      success: true,
      data: { rebuild_warning: rebuildWarning, trash: { id: trashed.trash_id, purge_after: trashed.purge_after } },
    });
  } catch (error) {
    return safeErrorResponse(toLeagueTrashError(error) ?? error, 'Failed to delete league');
  }
}
