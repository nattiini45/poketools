import { NextRequest, NextResponse } from 'next/server';
import { getLiveAccess, requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { seasonCreateSchema, formatZodErrors } from '@/lib/validation';
import { listSeasons, listArchivedSeasons, createSeason } from '@/lib/supabase/queries/seasons';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { getActiveListVersion, bindSeasonToList } from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import { initializeEpbFormatRules } from '@/lib/season/format-rules-defaults';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { SeasonWithDetails } from '@/types/season';

/**
 * GET /api/seasons — public list of active leagues, test leagues excluded.
 *
 * - `archived=true`: the archived leagues; any admin (requireAnyAdmin).
 * - `include_test=1`: the list WITH test leagues, for the Cast Studio league
 *   picker (casts are rehearsed on test leagues). Granted from the live roles
 *   to whoever may use the studio: site admins and creators in good standing
 *   (`getLiveAccess().isCreator`, the decision requireCreator() makes). Anyone
 *   else, signed out included, gets the public list: the flag only widens
 *   the list, so ignoring it leaks nothing. The answer depends on the viewer,
 *   so it is sent `private, no-store`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const archived = searchParams.get('archived') === 'true';

    if (archived) {
      await requireAnyAdmin();
      const seasons = await listArchivedSeasons();
      return NextResponse.json<ApiResult<SeasonWithDetails[]>>({
        success: true,
        data: seasons,
      });
    }

    if (searchParams.get('include_test') === '1') {
      const access = await getLiveAccess();
      const seasons = await listSeasons({ includeTestSeasons: access?.isCreator === true });
      return NextResponse.json<ApiResult<SeasonWithDetails[]>>(
        { success: true, data: seasons },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    // Public list: test leagues stay out (their own URL still serves them).
    const seasons = await listSeasons({ includeTestSeasons: false });
    return NextResponse.json<ApiResult<SeasonWithDetails[]>>({
      success: true,
      data: seasons,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch leagues');
  }
}

// Admin — create league
export async function POST(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();
    const rawBody = await request.json();
    const zodResult = seasonCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // `language` (the league's content language, i18n-core §6.1) passes
    // through with the rest; omitted, the column default ('de') applies.
    const season = await createSeason(zodResult.data);

    // Auto-initialize format rules for Evolution Point Buy seasons
    if (isEvolutionPointBuy(zodResult.data.format_type)) {
      await initializeEpbFormatRules(season.id);

      // Auto-bind the active point-buy list version (user request 2026-08-21):
      // upload once, every EPB league created afterwards is draft-ready.
      // Best-effort — a bind failure must not fail league creation.
      const activeList = await getActiveListVersion();
      if (activeList) {
        try {
          await bindSeasonToList(season.id, activeList.id);
          logAuditEvent({
            actor_id: player.playerId,
            actor_name: player.name,
            action: 'season.auto_bind_point_buy_list',
            resource_type: 'season',
            resource_id: season.id,
            metadata: { point_buy_list_id: activeList.id },
          });
        } catch (bindErr) {
          console.error(bindErr);
        }
      } else {
        console.warn('No active point-buy list version; EPB season created unbound:', season.id);
      }
    }

    // Auto-assign resource admin for non-site-admins
    if (!player.isAdmin) {
      await addResourceAdmin(player.playerId, 'season', season.id);
    }

    // The new league shows in the season list on the next view.
    expireSeasonReads(season.id);

    return NextResponse.json<ApiResult<typeof season>>(
      { success: true, data: season },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create league');
  }
}
