import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
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
import type { ApiResult } from '@/types/api';
import type { SeasonWithDetails } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// The DELETE handler rebuilds all derived data (aggregates, ratings, streaks)
// after the cascade — allow long-running rebuilds.
export const maxDuration = 300;

// Public
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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
    // hides the league from every public list and keeps the games recorded
    // from then on out of the all-time stats. League admins edit the rest.
    if (body.is_test_season !== undefined && !admin.isAdmin) {
      throw new UserFacingError('Only site admins can change the test-league flag', {
        code: 'season_test_flag_site_admin_only',
        status: 403,
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
    if (body.is_test_season !== undefined) {
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'season.set_test_flag',
        resource_type: 'season',
        resource_id: id,
        resource_name: season.name,
        metadata: { is_test_season: body.is_test_season },
      });
    }
    return NextResponse.json<ApiResult<typeof season>>({
      success: true,
      data: season,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update league');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const season = await getSeasonById(id);
    // Capture participants BEFORE the delete: the cascade removes the
    // participant rows, and they define whose ratings/streaks must be rebuilt.
    const participants = await getSeasonParticipants(id);
    await deleteSeason(id);
    expireSeasonReads(id);

    // Rebuild derived data built from the deleted season's matches. The
    // delete has already committed, so a rebuild failure must not read as a
    // failed delete — it is logged (server + audit metadata) and the §28
    // season audit surfaces the remaining drift for a follow-up --repair.
    let rebuild: EntityDeleteRebuildSummary | null = null;
    let rebuildError: string | null = null;
    try {
      rebuild = await rebuildAfterSeasonDelete({
        seasonId: id,
        playerIds: participants.map((p) => p.id),
      });
    } catch (err) {
      console.error('season delete derived-data rebuild failed:', err);
      rebuildError = 'derived_data_rebuild_failed';
    }

    logAuditEvent({
      action: 'season.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'season',
      resource_id: id,
      resource_name: season?.name ?? id,
      metadata: { rebuild, rebuild_error: rebuildError },
    });
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete league');
  }
}
