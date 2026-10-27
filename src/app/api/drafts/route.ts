import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAnyAdmin, requireResourceAdmin, requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { getDefaultRounds } from '@/lib/draft/engine';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import { defaultPickOrder, isPickOrderAllowed, isTurnEnforced } from '@/lib/draft/pool-format';
import { computeRedraftSeats } from '@/lib/draft/redraft-order';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { drawSeatOrder } from '@/lib/draft/seat-draw';
import {
  createQueueDraftSchema,
  DRAFT_CONFIG_LIMITS,
  invalidDraftConfigField,
  uuidSchema,
  type DraftConfigCore,
} from '@/lib/draft/schemas';
import { defaultRedraftDeadline, isValidQuietHours } from '@/lib/draft/time';
import { draftQuietHours } from '@/lib/format-pack';
import { expireDraftReads } from '@/lib/revalidation';
import {
  listDraftPools,
  getDraftPoolBySeason,
  getDraftPoolsBySeason,
  createDraftPool,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getEpbPhaseStatus } from '@/lib/season/epb-phase';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getGroupFirstHalfTables } from '@/lib/tournament/group-first-half';
import type { ApiResponse, ApiResult } from '@/types/api';
import type { DraftPool, DraftPoolWithDetails } from '@/types/draft';
import { DEFAULT_DRAFT_CONFIG, DEFAULT_SLOW_PICK_SECONDS, type AdminPoolSummary, type DraftConfigInput } from '@/types/draft-queue';
import { draftPoolCreateSchema, formatZodErrors } from '@/lib/validation';
import type { SeasonGroupWithMembers } from '@/types/season-group';

/** GET ?season_id= — the season's first pool (unchanged `data`) plus every pool of the season (route #2). */
type SeasonPoolsResponse = ApiResponse<DraftPool | null> & { pools: AdminPoolSummary[] };

/**
 * GET /api/drafts              — list all draft pools
 * GET /api/drafts?season_id=x  — the season's first draft pool (`data`) and all
 *                                its pools as `pools: AdminPoolSummary[]` (each with
 *                                its `engine`: `'legacy'` pre-M2 pools are not queue drafts).
 *                                In a league with groups `data` is the caller's own group's
 *                                initial pool (null for a caller in no group).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');
    // A malformed id names no league: 404 before any read, the session's included (repo convention, shared guard
    // test src/app/api/__tests__/path-id-guards.test.ts). It reveals nothing: the answer is the same for everyone.
    if (seasonId) {
      const invalid = rejectInvalidPathId(seasonId, 'INVALID_SEASON_ID');
      if (invalid) return invalid;
    }
    const player = await requirePlayer();

    if (seasonId) {
      const [pool, pools] = await Promise.all([
        getInitialPoolForPlayer(seasonId, player.playerId),
        getDraftPoolsBySeason(seasonId),
      ]);
      return NextResponse.json<SeasonPoolsResponse>({ success: true, data: pool, pools });
    }

    const pools = await listDraftPools();
    return NextResponse.json<ApiResult<DraftPoolWithDetails[]>>({ success: true, data: pools });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch draft pools');
  }
}

const seasonIdOnlySchema = z.object({ season_id: uuidSchema });

/**
 * The queue body of a league with groups names the group whose pool it creates (`season_group_id`); a league
 * without groups sends none (the body is then exactly `createQueueDraftSchema`). Strict like its base.
 */
const createGroupQueueDraftSchema = createQueueDraftSchema.extend({ season_group_id: uuidSchema.optional() });
type CreateGroupQueueDraftInput = z.infer<typeof createGroupQueueDraftSchema>;

interface Seat {
  player_id: string;
  seat: number;
  standing_rank?: number;
}

/** Seats from an admin-chosen order; it must be exactly the season's (or the group's) participant set. */
function seatsFromOrder(participantIds: ReadonlySet<string>, order: readonly string[]): Seat[] {
  if (order.length !== participantIds.size || order.some((pid) => !participantIds.has(pid))) {
    throw new DraftRuleError('SEATS_INVALID');
  }
  return order.map((player_id, index) => ({ player_id, seat: index + 1 }));
}

/**
 * Redraft seats from the first-half (Hinrunde) standings: last place picks first (§8.1 #1).
 * Requires a complete first half unless `force`.
 *
 * League groups: `group` = the league group whose Redraft this is. The order is the group's own first-half table
 * (`getGroupFirstHalfTables`: the primary phase's group table over its first half of planned weeks, every match of
 * its members counted, cross-group matches included; the Hinrunde boundary is shared by every group). When that table does not hold exactly the group's members (the primary phase's groups do not mirror the
 * league groups yet, or a member is not enrolled there), the order falls back to the league's first-half table
 * restricted to the group's members, which always seats exactly them.
 */
async function redraftSeats(
  seasonId: string,
  force: boolean,
  group: SeasonGroupWithMembers | null,
): Promise<Seat[]> {
  const [phase, participants, groupTables] = await Promise.all([
    getEpbPhaseStatus(seasonId),
    getSeasonParticipants(seasonId),
    group ? getGroupFirstHalfTables(seasonId) : Promise.resolve(null),
  ]);
  if (!force && !phase.hinrunde_complete) throw new DraftRuleError('REDRAFT_NOT_YET_ALLOWED');

  const members = group ? new Set(group.player_ids) : null;
  const groupTable = group ? groupTables?.tables.get(group.id) : undefined;
  if (members && groupTable && groupTable.length === members.size && groupTable.every((s) => members.has(s.player_id))) {
    return computeRedraftSeats(groupTable);
  }

  const firstHalf = new Set(phase.hinrunde_round_numbers);
  const records = phase.tournament_id
    ? (await getCompletedMatchRecords(phase.tournament_id)).filter((m) => firstHalf.has(m.round_number))
    : [];
  const ids = participants.map((p) => p.id);
  const names: Record<string, string> = {};
  for (const p of participants) names[p.id] = p.name;
  const standings = await computeStandingsForSeason(seasonId, ids, names, records);
  return computeRedraftSeats(members ? standings.filter((s) => members.has(s.player_id)) : standings);
}

/**
 * The group a queue body creates a pool for. A league with groups needs one of its groups (SEASON_GROUP_REQUIRED /
 * SEASON_GROUP_INVALID, before any seat is computed); a league without groups takes none.
 */
function resolveCreateGroup(
  groups: readonly SeasonGroupWithMembers[],
  seasonGroupId: string | undefined,
): SeasonGroupWithMembers | null {
  if (groups.length === 0) {
    if (seasonGroupId !== undefined) throw new DraftRuleError('SEASON_GROUP_INVALID');
    return null;
  }
  if (seasonGroupId === undefined) throw new DraftRuleError('SEASON_GROUP_REQUIRED');
  const group = groups.find((g) => g.id === seasonGroupId.toLowerCase());
  if (!group) throw new DraftRuleError('SEASON_GROUP_INVALID');
  return group;
}

/**
 * The format pack's pick-clock quiet window as `draft_create_pool`'s `config.quiet_hours` (null = none).
 * Server-side only: the request schema is strict, so a client cannot send or override it. A pack window the SQL
 * would refuse is a deployment error (500), not the admin's input error.
 */
function packQuietHoursConfig(): { start_hour: number; end_hour: number; time_zone: string } | null {
  const quiet = draftQuietHours();
  if (quiet === null) return null;
  if (!isValidQuietHours(quiet)) throw new Error('format pack epb.draftClock.quietHours is invalid');
  return { start_hour: quiet.startHour, end_hour: quiet.endHour, time_zone: quiet.timeZone };
}

/**
 * The pool's clock settings as the request leaves them: a slow draft that names no pick time gets the slow default,
 * because the SQL default (300 s) is below the slow minimum (`DRAFT_CONFIG_LIMITS.pick_seconds.slow`).
 */
function withSlowPickDefault(config: DraftConfigInput): DraftConfigInput {
  return config.mode === 'slow' && config.pick_seconds === undefined
    ? { ...config, pick_seconds: DEFAULT_SLOW_PICK_SECONDS }
    : config;
}

/**
 * The fields of the request that depend on each other, as the new pool will hold them. Only what the request names is
 * judged: the engine defaults for the clock (live 300 s, slow 43 200 s) stand in for an omitted pick time, while an
 * omitted roster size, budget or make-up time cannot be refused (the roster size and budget default from the season's
 * format rules in SQL, which this route does not load), and a Redraft line cap is checked against the roster size only
 * when the request names both. `PATCH /api/drafts/[id]/config` checks the stored config the same way
 * (`invalidDraftConfigField`).
 */
function createdCore(config: DraftConfigInput): DraftConfigCore {
  const mode = config.mode ?? DEFAULT_DRAFT_CONFIG.mode;
  const pick = config.pick_seconds ?? DEFAULT_DRAFT_CONFIG.pick_seconds;
  return {
    mode,
    // In-range stand-ins for what the request omits: they never decide the outcome.
    roster_size: config.roster_size ?? DRAFT_CONFIG_LIMITS.roster_size.max,
    budget: config.budget ?? DRAFT_CONFIG_LIMITS.budget.min,
    pick_seconds: pick,
    makeup_seconds: config.makeup_seconds ?? Math.min(DEFAULT_DRAFT_CONFIG.makeup_seconds, pick),
    slow_ladder_seconds: config.slow_ladder_seconds ?? [...DEFAULT_DRAFT_CONFIG.slow_ladder_seconds],
    redraft_max_lines: config.roster_size === undefined ? null : (config.redraft_max_lines ?? null),
  };
}

/**
 * Queue-engine creation (EPB seasons): `draft_create_pool` freezes config and
 * seats and logs `draft_configured` (actor + new state). The pool's quiet hours
 * come from the format pack (`packQuietHoursConfig`), for initial and redraft pools.
 * The config is checked as a whole before anything is written (`INVALID_CONFIG {field}`), and an Initial pool
 * without an admin order is seated by a random draw (`drawSeatOrder`), not in database row order.
 */
async function createQueuePool(
  input: CreateGroupQueueDraftInput,
  actorId: string,
  group: SeasonGroupWithMembers | null,
): Promise<NextResponse> {
  const { participant_order: order, ...requested } = input.config ?? {};
  const config = { ...withSlowPickDefault(requested) };
  const invalidField = invalidDraftConfigField(createdCore(config));
  if (invalidField) throw new DraftRuleError('INVALID_CONFIG', { field: invalidField });

  const groupMembers = group ? new Set(group.player_ids) : null;
  /** The seats' roster: the season's participants, or the group's members. */
  const rosterIds = async (): Promise<string[]> => {
    const ids = (await getSeasonParticipants(input.season_id)).map((p) => p.id);
    return groupMembers ? ids.filter((id) => groupMembers.has(id)) : ids;
  };
  let seats: Seat[];

  if (input.kind === 'initial') {
    const ids = await rosterIds();
    // An admin order wins; otherwise the opening order is drawn (a group's pool draws within the group).
    seats = seatsFromOrder(new Set(ids), order ?? drawSeatOrder(ids));
  } else {
    if (order) {
      seats = seatsFromOrder(new Set(await rosterIds()), order);
    } else {
      seats = await redraftSeats(input.season_id, input.force === true, group);
    }
    if (config.submission_deadline_at == null) {
      config.submission_deadline_at = defaultRedraftDeadline(new Date()).toISOString();
    }
  }

  const poolId = await callDraftRpc<string>('draft_create_pool', {
    p_season_id: input.season_id,
    p_kind: input.kind,
    p_actor_id: actorId,
    p_config: { ...config, quiet_hours: packQuietHoursConfig() },
    p_seats: seats,
    // Only a league with groups names one: the call of a league without groups stays exactly as before.
    ...(group ? { p_season_group_id: group.id } : {}),
  });
  expireDraftReads(input.season_id);
  return NextResponse.json<ApiResult<{ pool_id: string }>>({ success: true, data: { pool_id: poolId } }, { status: 201 });
}

/**
 * POST /api/drafts — create a draft pool (season admin only).
 *
 * EPB seasons create a queue-engine pool: body `{ season_id, kind: 'initial' | 'redraft', config?, force? }`
 * → `201 { pool_id }`. A body in the legacy shape (`draft_type`, `budget`) for
 * an EPB season creates the initial queue pool with that budget; a `default_point_cost`
 * in it is refused (`400 validation_failed`), since point-buy seasons price from their list.
 * Other seasons take the legacy path: `{ season_id, draft_type, pick_order?, budget?, default_point_cost? }`
 * (`default_point_cost` only for `budget` pools; on any other type it is `400 validation_failed`).
 * `draft_type` is the pricing, `pick_order` the turn order (omitted = snake for snake, free otherwise);
 * an auction with a non-free order is `400 draft_auction_order_not_free`.
 */
export async function POST(request: NextRequest) {
  try {
    // Cheap global guard first: an unauthenticated or non-admin caller never
    // gets its body parsed or validated (AGENTS.md: auth guard FIRST). The
    // season-specific check follows once the season id is known.
    await requireAnyAdmin();
    const rawBody: unknown = await request.json();
    const idResult = seasonIdOnlySchema.safeParse(rawBody);
    if (!idResult.success) {
      const issues = formatZodErrors(idResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const seasonId = idResult.data.season_id;
    const admin = await requireResourceAdmin('season', seasonId);

    const season = await getSeasonById(seasonId);
    if (season && isEvolutionPointBuy(season.format_type)) {
      try {
        const isQueueBody = typeof rawBody === 'object' && rawBody !== null && 'kind' in rawBody;
        let input: CreateGroupQueueDraftInput;
        if (isQueueBody) {
          input = createGroupQueueDraftSchema.parse(rawBody);
        } else {
          const legacy = draftPoolCreateSchema.parse(rawBody);
          // The queue engine has no pool default price: refuse it rather than drop it silently.
          if (legacy.default_point_cost != null) {
            const issues = 'default_point_cost: point-buy seasons price picks from the point-buy list';
            return NextResponse.json<ApiResult<never>>(
              { success: false, error: issues, code: 'validation_failed', params: { issues } },
              { status: 400 }
            );
          }
          input = {
            season_id: legacy.season_id,
            kind: 'initial',
            config: legacy.budget != null && legacy.budget >= 1 ? { budget: legacy.budget } : undefined,
          };
        }
        const group = resolveCreateGroup(await getSeasonGroups(seasonId), input.season_group_id);
        return await createQueuePool(input, admin.playerId, group);
      } catch (err) {
        return draftErrorResponse(err, 'Failed to create draft pool');
      }
    }

    // ── Legacy engine (non-EPB seasons) ──
    const zodResult = draftPoolCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    if ((body.draft_type === 'auction' || body.draft_type === 'budget') && body.budget == null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'point_budget is required for auction/budget drafts', code: 'POINT_BUDGET_REQUIRED' },
        { status: 400 }
      );
    }

    // Turn order and pricing are separate axes; an omitted order keeps what draft_type implied before the split.
    const pickOrder = body.pick_order ?? defaultPickOrder(body.draft_type);
    if (!isPickOrderAllowed(body.draft_type, pickOrder)) {
      const error = 'Auction drafts need free pick order: the winning bidder gets the pick';
      return NextResponse.json<ApiResult<never>>(
        { success: false, error, code: 'draft_auction_order_not_free' },
        { status: 400 }
      );
    }

    // Fixed costs in a turn order: a player who cannot afford their remaining rounds stalls everyone, so a
    // budget below rounds × default price (what an unpriced Pokémon costs) could never finish. Pool entries
    // are added after creation, so only the default price is checked here.
    const rounds = getDefaultRounds(body.draft_type);
    if (
      body.draft_type === 'budget' && isTurnEnforced(pickOrder) && body.budget != null &&
      body.default_point_cost != null && body.budget < rounds * body.default_point_cost
    ) {
      const minimum = rounds * body.default_point_cost;
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `A budget of ${body.budget} cannot fill ${rounds} picks at the default price of ${body.default_point_cost} (needs ${minimum})`,
          code: 'draft_budget_below_rounds',
          params: { budget: body.budget, rounds, price: body.default_point_cost, minimum },
        },
        { status: 400 }
      );
    }

    // A league with groups drafts per group, which only the queue engine runs (a legacy pool has no seats, so
    // nothing would keep a trainer to their own group's pool). Refused before any write.
    if ((await getSeasonGroups(body.season_id)).length > 0) {
      const error =
        'This league has groups. Groups draft separately, which only Evolution Point Buy leagues support. Remove the groups on the Participants tab to run one draft for everyone.';
      console.error(`[API] legacy draft pool refused for league ${body.season_id}: the league has groups`);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error, code: 'draft_groups_need_point_buy' },
        { status: 409 }
      );
    }

    // Check if season already has a draft pool
    const existing = await getDraftPoolBySeason(body.season_id);
    if (existing) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'This season already has a draft pool', code: 'POOL_EXISTS' },
        { status: 409 }
      );
    }

    // EPB seasons take the queue path above (their budget defaults from format_rules in SQL).
    // An omitted default_point_cost stays null: an unpriced entry then costs 0.
    const pool = await createDraftPool({
      season_id: body.season_id,
      draft_type: body.draft_type,
      pick_order: pickOrder,
      point_budget: body.budget ?? null,
      default_point_cost: body.default_point_cost ?? null,
    });
    // The league page's cached `hasDraftPool` flips now, not when the entry ages out (D37).
    expireDraftReads(body.season_id);
    return NextResponse.json<ApiResult<DraftPool>>({ success: true, data: pool }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create draft pool');
  }
}
