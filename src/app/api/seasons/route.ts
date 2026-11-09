import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import { formatZodErrors } from '@/lib/validation';
import { seasonCreateWithFormatSchema, type SeasonFromFormatBody } from '@/lib/format-studio/api-schemas';
import { createLeagueFromFormat, type CreatedLeague, type LeagueFields } from '@/lib/format-studio/create-league';
import { getAdminScope } from '@/lib/auth/admin-scope';
import {
  listSeasons,
  listArchivedSeasons,
  listSeasonsByIds,
  createSeason,
} from '@/lib/supabase/queries/seasons';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { getActiveListVersion, bindSeasonToList } from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import { initializeEpbFormatRules } from '@/lib/season/format-rules-defaults';
import { ensurePointBuyBattleRuleset } from '@/lib/season/point-buy-battle-ruleset';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { assertSeasonDateRange } from '@/lib/season/settings-guards';
import { expireFormatLibraryReads, expireSeasonReads } from '@/lib/revalidation';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import {
  assertCloneAllowed,
  copyLeagueStructure,
  createCloneTracker,
  rollbackClonedLeague,
  type CloneReport,
} from '@/lib/season/clone';
import { assertRulesetUsableForCreate } from '@/lib/ruleset-studio/pin-change';
import type { ApiResult } from '@/types/api';
import type { SessionPlayer } from '@/types/auth';
import type { Season, SeasonWithDetails } from '@/types/season';

/** League creations per admin and hour, every way of creating one (plan Q9). */
const SEASON_CREATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const;
/** The bucket of the format create and fork routes: a league from an example also forks a format. */
const FORMAT_CREATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const;

export interface SeasonFromFormatResult {
  season: Season;
  format: CreatedLeague['format'];
  stages: CreatedLeague['stages'];
  warnings: CreatedLeague['warnings'];
}

/**
 * GET /api/seasons — public list of active leagues, test leagues included
 * (sorted after the real leagues, flagged by `is_test_season` so clients can
 * badge them). The same list for every viewer, signed out included: test
 * leagues are open for the community to test together.
 *
 * - `archived=true`: the archived leagues the caller may administer; any admin
 *   (requireAnyAdmin). A site admin gets every archived league, a resource
 *   admin only the ones assigned to them (`getAdminScope`).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const archived = searchParams.get('archived') === 'true';

    if (archived) {
      const scope = await getAdminScope(await requireAnyAdmin());
      const seasons = scope.seasonIds === null
        ? await listArchivedSeasons()
        : await listSeasonsByIds(scope.seasonIds, { archived: true });
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

/**
 * The new-competition wizard: the league, its format (an example forked and published, or a published version) and its
 * stages in one transaction (`src/lib/format-studio/create-league.ts`). Every check runs before the one write.
 */
async function createFromFormat(player: SessionPlayer, fields: LeagueFields, fromFormat: SeasonFromFormatBody): Promise<NextResponse> {
  const forks = 'preset_id' in fromFormat;
  if (forks) {
    const rate = await checkRateLimit('format-create', player.playerId, FORMAT_CREATE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);
  }
  await assertRulesetUsableForCreate(player, fields.ruleset_id);

  const created = await createLeagueFromFormat({ actor: player, season: fields, fromFormat });

  // Committed: the league list, the new league's pages and (for a fork) the format library show it on the next view.
  expireSeasonReads(created.season_id, created.stage_ids);
  if (forks) expireFormatLibraryReads();
  if (created.ruleset_ids.length > 0) revalidatePath('/admin/rulesets');

  logAuditEvent({
    actor_id: player.playerId,
    actor_name: player.name,
    action: 'season.create_from_format',
    resource_type: 'season',
    resource_id: created.season_id,
    resource_name: fields.name,
    metadata: {
      definition_id: created.format.definition_id,
      version_no: created.format.version_no,
      preset_id: created.preset_id,
      stage_count: created.stages.length,
    },
  });

  return NextResponse.json<ApiResult<SeasonFromFormatResult>>(
    { success: true, data: { season: created.season, format: created.format, stages: created.stages, warnings: created.warnings } },
    { status: 201 },
  );
}

/**
 * Admin — create league. At most 20 per admin and hour (`season-create`).
 *
 * `clone_from` starts the league from an existing one: after the normal
 * creation below, the source's phases (and on request its roster and, for
 * site admins, its league admins) are copied, and a failure removes the new
 * league again (`src/lib/season/clone.ts`). The 201 body then carries
 * `data.clone`, the copy report.
 *
 * `from_format` (the new-competition wizard, `format_type: 'custom'`, never
 * with `clone_from`) creates the league with its format and stages in one
 * transaction; the 201 body is `{ season, format, stages, warnings }`.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();

    const rate = await checkRateLimit('season-create', player.playerId, SEASON_CREATE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const rawBody = await request.json();
    const zodResult = seasonCreateWithFormatSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { clone_from: cloneFrom, from_format: fromFormat, ...seasonFields } = zodResult.data;

    // The schema checks each date alone; the order of the two is checked here
    // (a refine on the schema would stop PATCH from extending it).
    assertSeasonDateRange(seasonFields.start_date, seasonFields.end_date);

    if (fromFormat !== undefined) return await createFromFormat(player, seasonFields, fromFormat);

    // A refusal comes before any write: nothing is created for a source the
    // caller may not copy (the ruleset ensure below is a write too).
    const cloneSource = cloneFrom
      ? (
          await assertCloneAllowed(player, {
            sourceId: cloneFrom.season_id,
            copyAdmins: cloneFrom.copy_admins,
          })
        ).source
      : null;

    const isPointBuy = isEvolutionPointBuy(seasonFields.format_type);

    // A point-buy league battles in Gen 9 singles under its format_rules: without
    // an explicit ruleset, its default is the pack's battle ruleset (one shared,
    // non-custom row without bans, created on first use), so phases need no
    // manual ruleset (docs/evolution-point-buy.md). Any admin who may create a
    // league (requireAnyAdmin) thereby creates or repairs that shared row; its
    // content is fixed server-side, never taken from the request.
    await assertRulesetUsableForCreate(player, seasonFields.ruleset_id);
    let seasonInput = seasonFields;
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

    // From here on a clone undoes the new league if anything fails. Without
    // `clone_from` there is no tracker and the error passes through unchanged.
    const cloneTracker =
      cloneFrom && cloneSource
        ? createCloneTracker({
            seasonId: season.id,
            seasonName: season.name,
            sourceId: cloneSource.id,
            actor: player,
          })
        : null;
    let cloneReport: CloneReport | null = null;

    try {
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
            logger.error('api/seasons', 'auto-bind of the active point-buy list version failed', {
              seasonId: season.id,
              pointBuyListId: activeList.id,
              error: bindErr,
            });
          }
        } else {
          logger.warn('api/seasons', 'No active point-buy list version; EPB season created unbound', {
            seasonId: season.id,
          });
        }
      }

      // Auto-assign resource admin for non-site-admins
      if (!player.isAdmin) {
        await addResourceAdmin(player.playerId, 'season', season.id);
        if (cloneTracker) cloneTracker.creatorGrant = true;
      }

      if (cloneFrom && cloneSource && cloneTracker) {
        cloneReport = await copyLeagueStructure(
          season,
          cloneSource,
          player,
          { copyRoster: cloneFrom.copy_roster, copyAdmins: cloneFrom.copy_admins },
          cloneTracker,
        );
      }
    } catch (err) {
      if (!cloneTracker) throw err;
      await rollbackClonedLeague(cloneTracker, err);
    }

    // Logged here, past the clone rollback (which throws), so a league that was removed again
    // leaves no creation event.
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'season.create',
      resource_type: 'season',
      resource_id: season.id,
      resource_name: season.name,
      metadata: {
        format_type: season.format_type,
        ruleset_id: season.ruleset_id ?? null,
        clone_from: cloneSource?.id ?? null,
      },
    });

    // The new league shows in the season list on the next view.
    expireSeasonReads(season.id);

    return NextResponse.json<ApiResult<typeof season & { clone?: CloneReport }>>(
      { success: true, data: cloneReport ? { ...season, clone: cloneReport } : season },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create league');
  }
}
