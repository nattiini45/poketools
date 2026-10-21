import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { seasonCreateSchema, formatZodErrors } from '@/lib/validation';
import { listSeasons, listArchivedSeasons, createSeason } from '@/lib/supabase/queries/seasons';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { getActiveListVersion, bindSeasonToList } from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import { initializeEpbFormatRules } from '@/lib/season/format-rules-defaults';
import { ensurePointBuyBattleRuleset } from '@/lib/season/point-buy-battle-ruleset';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { SeasonWithDetails } from '@/types/season';

/**
 * GET /api/seasons — public list of active leagues, test leagues included
 * (sorted after the real leagues, flagged by `is_test_season` so clients can
 * badge them). The same list for every viewer, signed out included: test
 * leagues are open for the community to test together.
 *
 * - `archived=true`: the archived leagues; any admin (requireAnyAdmin).
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

    const seasons = await listSeasons();
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

    const isPointBuy = isEvolutionPointBuy(zodResult.data.format_type);

    // A point-buy league battles in Gen 9 singles under its format_rules: without
    // an explicit ruleset, its default is the pack's battle ruleset (one shared,
    // non-custom row without bans, created on first use), so phases need no
    // manual ruleset (docs/evolution-point-buy.md). Any admin who may create a
    // league (requireAnyAdmin) thereby creates or repairs that shared row; its
    // content is fixed server-side, never taken from the request.
    let seasonInput = zodResult.data;
    if (isPointBuy && !seasonInput.ruleset_id) {
      const ensured = await ensurePointBuyBattleRuleset(player.playerId);
      seasonInput = { ...seasonInput, ruleset_id: ensured.ruleset.id };
      if (ensured.created) {
        logAuditEvent({
          actor_id: player.playerId,
          actor_name: player.name,
          action: 'season.auto_create_battle_ruleset',
          resource_type: 'ruleset',
          resource_id: ensured.ruleset.id,
          metadata: { name: ensured.ruleset.name },
        });
      }
      if (ensured.bansCleared) {
        logAuditEvent({
          actor_id: player.playerId,
          actor_name: player.name,
          action: 'season.clear_battle_ruleset_bans',
          resource_type: 'ruleset',
          resource_id: ensured.ruleset.id,
          metadata: { name: ensured.ruleset.name },
        });
      }
    }

    // `language` (the league's content language, i18n-core §6.1) passes
    // through with the rest; omitted, the column default ('de') applies.
    const season = await createSeason(seasonInput);

    // Auto-initialize format rules for Evolution Point Buy seasons
    if (isPointBuy) {
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
