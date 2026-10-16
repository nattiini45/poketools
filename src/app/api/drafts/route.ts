import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAnyAdmin, requireResourceAdmin, requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { getDefaultRounds } from '@/lib/draft/engine';
import { defaultPickOrder, isPickOrderAllowed, isTurnEnforced } from '@/lib/draft/pool-format';
import { computeRedraftSeats } from '@/lib/draft/redraft-order';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { createQueueDraftSchema, uuidSchema, type CreateQueueDraftInput } from '@/lib/draft/schemas';
import { defaultRedraftDeadline } from '@/lib/draft/time';
import { expireDraftReads } from '@/lib/revalidation';
import {
  listDraftPools,
  getDraftPoolBySeason,
  getDraftPoolsBySeason,
  createDraftPool,
} from '@/lib/supabase/queries/drafts';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getEpbPhaseStatus } from '@/lib/season/epb-phase';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import type { ApiResponse, ApiResult } from '@/types/api';
import type { DraftPool, DraftPoolWithDetails } from '@/types/draft';
import type { AdminPoolSummary } from '@/types/draft-queue';
import { draftPoolCreateSchema, formatZodErrors } from '@/lib/validation';

/** GET ?season_id= — the season's first pool (unchanged `data`) plus every pool of the season (route #2). */
type SeasonPoolsResponse = ApiResponse<DraftPool | null> & { pools: AdminPoolSummary[] };

/**
 * GET /api/drafts              — list all draft pools
 * GET /api/drafts?season_id=x  — the season's first draft pool (`data`) and all
 *                                its pools as `pools: AdminPoolSummary[]` (each with
 *                                its `engine`: `'legacy'` pre-M2 pools are not queue drafts)
 */
export async function GET(request: NextRequest) {
  try {
    await requirePlayer();
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');

    if (seasonId) {
      const [pool, pools] = await Promise.all([getDraftPoolBySeason(seasonId), getDraftPoolsBySeason(seasonId)]);
      return NextResponse.json<SeasonPoolsResponse>({ success: true, data: pool, pools });
    }

    const pools = await listDraftPools();
    return NextResponse.json<ApiResult<DraftPoolWithDetails[]>>({ success: true, data: pools });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch draft pools');
  }
}

const seasonIdOnlySchema = z.object({ season_id: uuidSchema });

interface Seat {
  player_id: string;
  seat: number;
  standing_rank?: number;
}

/** Seats from an admin-chosen order; it must be exactly the season's participant set. */
function seatsFromOrder(participantIds: ReadonlySet<string>, order: readonly string[]): Seat[] {
  if (order.length !== participantIds.size || order.some((pid) => !participantIds.has(pid))) {
    throw new DraftRuleError('SEATS_INVALID');
  }
  return order.map((player_id, index) => ({ player_id, seat: index + 1 }));
}

/**
 * Redraft seats from the first-half (Hinrunde) standings: last place picks first (§8.1 #1).
 * Requires a complete first half unless `force`.
 */
async function redraftSeats(seasonId: string, force: boolean): Promise<Seat[]> {
  const [phase, participants] = await Promise.all([getEpbPhaseStatus(seasonId), getSeasonParticipants(seasonId)]);
  if (!force && !phase.hinrunde_complete) throw new DraftRuleError('REDRAFT_NOT_YET_ALLOWED');

  const firstHalf = new Set(phase.hinrunde_round_numbers);
  const records = phase.tournament_id
    ? (await getCompletedMatchRecords(phase.tournament_id)).filter((m) => firstHalf.has(m.round_number))
    : [];
  const ids = participants.map((p) => p.id);
  const names: Record<string, string> = {};
  for (const p of participants) names[p.id] = p.name;
  const standings = await computeStandingsForSeason(seasonId, ids, names, records);
  return computeRedraftSeats(standings);
}

/**
 * Queue-engine creation (EPB seasons): `draft_create_pool` freezes config and
 * seats and logs `draft_configured` (actor + new state).
 */
async function createQueuePool(input: CreateQueueDraftInput, actorId: string): Promise<NextResponse> {
  const { participant_order: order, ...config } = input.config ?? {};
  let seats: Seat[];

  if (input.kind === 'initial') {
    const participants = await getSeasonParticipants(input.season_id);
    const ids = participants.map((p) => p.id);
    seats = order ? seatsFromOrder(new Set(ids), order) : ids.map((player_id, index) => ({ player_id, seat: index + 1 }));
  } else {
    if (order) {
      const participants = await getSeasonParticipants(input.season_id);
      seats = seatsFromOrder(new Set(participants.map((p) => p.id)), order);
    } else {
      seats = await redraftSeats(input.season_id, input.force === true);
    }
    if (config.submission_deadline_at == null) {
      config.submission_deadline_at = defaultRedraftDeadline(new Date()).toISOString();
    }
  }

  const poolId = await callDraftRpc<string>('draft_create_pool', {
    p_season_id: input.season_id,
    p_kind: input.kind,
    p_actor_id: actorId,
    p_config: config,
    p_seats: seats,
  });
  expireDraftReads(input.season_id);
  return NextResponse.json<ApiResult<{ pool_id: string }>>({ success: true, data: { pool_id: poolId } }, { status: 201 });
}

/**
 * POST /api/drafts — create a draft pool (season admin only; draft-backend §8.1 #1).
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
        let input: CreateQueueDraftInput;
        if (isQueueBody) {
          input = createQueueDraftSchema.parse(rawBody);
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
        return await createQueuePool(input, admin.playerId);
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
