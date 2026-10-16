import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { draftErrorResponse } from '@/lib/draft/http';
import { scheduleDraftNotifications } from '@/lib/draft/notify';
import { draftStateQuerySchema, uuidSchema } from '@/lib/draft/schemas';
import { getDraftSnapshot, type DraftSnapshotUnchanged } from '@/lib/draft/snapshot';
import { expireDraftReads } from '@/lib/revalidation';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getDraftPoolById, getPicksByPool } from '@/lib/supabase/queries/drafts';
import { getSeasonParticipants, getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { epbPack } from '@/lib/format-pack';
import { SQL_DRAFT_PICKS_FALLBACK } from '@/lib/draft/sql-fallbacks';
import { getAllTiers, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import {
  availablePricesSorted,
  computeDraftState,
  legacyPickerStall,
  legacySeatOrder,
  resolveTotalRounds,
  type PickerStall,
} from '@/lib/draft/engine';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { computeDraftTokens } from '@/lib/draft/point-buy-engine';
import {
  computeRemainingPointsFromLedger,
  hasAllocatedDraftTokensFromLedger,
  loadDraftTokenLedger,
} from '@/lib/draft/progress-engine';
import { collectTakenLineIdentities } from '@/lib/draft/line-identity';
import { toPublicPicks, type PublicDraftPick } from '@/lib/draft/public-pick';
import type { ApiResult } from '@/types/api';
import type { DraftSnapshotDTO } from '@/types/draft-queue';
import type { EvolutionTier, EvolutionTracker, EvolutionTrackerWithTier } from '@/types/evolution';

/** Serializable version of DraftState (Set → array) */
interface DraftStateResponse {
  pool: ReturnType<typeof computeDraftState>['pool'];
  /** Standing picks only, in the public allowlist shape (no admin correction data). */
  picks: PublicDraftPick[];
  rosters: ReturnType<typeof computeDraftState>['rosters'];
  budgets: ReturnType<typeof computeDraftState>['budgets'];
  pick_order: string[];
  /** A display suggestion only when `turn_enforced` is false (free order). */
  current_picker: string | null;
  turn_enforced: boolean;
  /**
   * Snake/linear order with fixed costs: the current picker cannot afford any pick that leaves enough points for
   * their open picks, so the draft cannot go on until an admin switches the pool to free order. Null otherwise.
   */
  stalled_picker: PickerStall | null;
  next_pick_number: number;
  current_round: number;
  taken_pokemon: string[];
  /**
   * EPB: drafted line identities (base|stage3) from evolution trackers.
   * Board must use this instead of re-deriving from client tracker state.
   */
  taken_line_identities?: string[];
  /** EPB-only metadata for the draft room UI */
  epb?: {
    draft_budget: number;
    draft_picks: number;
    token_ratio: number;
    token_max: number;
    picks_by_player: Record<string, number>;
    purchasable_tokens_by_player: Record<string, number>;
    tokens_allocated_by_player: Record<string, boolean>;
  };
  /**
   * EPB with `?include=trackers` only: every rostered player's trackers with
   * their tier, so the 2D board needs one request per poll instead of one
   * tiers call plus one trackers call per player.
   */
  evolution?: {
    /** The season has evolution tiers (the board's evo-league mode). */
    is_evo_league: boolean;
    /** player_id → trackers with tier; empty when is_evo_league is false. */
    trackers_by_player: Record<string, EvolutionTrackerWithTier[]>;
  };
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Optional payload sections a client can ask for with `?include=`. */
const VALID_STATE_INCLUDES = ['trackers'] as const;
type StateInclude = (typeof VALID_STATE_INCLUDES)[number];

function isStateInclude(value: string): value is StateInclude {
  return (VALID_STATE_INCLUDES as readonly string[]).includes(value);
}

/**
 * Attach tiers to each rostered player's trackers, mirroring
 * getPlayerTrackersWithTiers: the player's wildcard wins over the general tier
 * list. A player with a tracker that has no tier is left out, as the old
 * per-player /api/evolutions/trackers call failed for that player; the gap is
 * logged so the data error stays visible.
 */
function groupTrackersWithTiers(
  seasonId: string,
  playerIds: string[],
  trackers: EvolutionTracker[],
  tiers: EvolutionTier[],
): Record<string, EvolutionTrackerWithTier[]> {
  const byPlayer: Record<string, EvolutionTrackerWithTier[]> = {};

  for (const playerId of playerIds) {
    const withTiers: EvolutionTrackerWithTier[] = [];
    let missingTier: string | null = null;

    for (const tracker of trackers) {
      if (tracker.player_id !== playerId) continue;
      const tier =
        tiers.find((t) => t.base_pokemon === tracker.base_pokemon && t.player_id === playerId) ??
        tiers.find((t) => t.base_pokemon === tracker.base_pokemon && t.player_id === null);
      if (!tier) {
        missingTier = tracker.base_pokemon;
        break;
      }
      withTiers.push({ ...tracker, tier });
    }

    if (missingTier !== null) {
      console.error(
        `[api/drafts/state] No evolution tier found for ${missingTier} (player ${playerId}) in season ${seasonId}; trackers omitted`,
      );
      continue;
    }
    byPlayer[playerId] = withTiers;
  }

  return byPlayer;
}

/**
 * GET /api/drafts/[id]/state — the draft state the draft room polls.
 *
 * Queue-engine pools (draft-backend §8.1 #7): one `draft_snapshot` RPC that
 * ticks (timeouts, redraft auto-publish) and answers a `DraftSnapshotDTO`, or
 * `{ unchanged, state_version, server_now }` when `?since=` equals the current
 * `state_version`. A publish in this request expires the draft reads; a
 * publish or a resolved timeout schedules the Discord notification claim.
 *
 * Legacy pools: the computed legacy state; `include=trackers` (optional) adds
 * the EPB `evolution` section.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    const include = request.nextUrl.searchParams.get('include');
    if (include !== null && !isStateInclude(include)) {
      const allowed = VALID_STATE_INCLUDES.join(', ');
      throw new UserFacingError(`include must be one of: ${allowed}`, {
        code: 'INVALID_INCLUDE',
        params: { allowed },
        status: 400,
      });
    }
    const includeTrackers = include === 'trackers';

    // A malformed id is a missing pool, not a database error.
    const pool = uuidSchema.safeParse(id).success ? await getDraftPoolById(id) : null;
    if (!pool) {
      throw new UserFacingError('Draft pool not found', { code: 'POOL_NOT_FOUND', status: 404 });
    }

    if (pool.engine === 'queue') {
      const query = draftStateQuerySchema.parse({
        since: request.nextUrl.searchParams.get('since') ?? undefined,
        include: include ?? undefined,
      });
      const isPoolAdmin =
        player.isAdmin ||
        (player.isResourceAdmin === true && (await isResourceAdminFor(player.playerId, 'season', pool.season_id)));
      const { dto, publishedNow, timeoutsResolved } = await getDraftSnapshot(
        id,
        { playerId: player.playerId, isPoolAdmin },
        { since: query.since },
      );
      if (publishedNow) expireDraftReads(pool.season_id);
      // A resolved timeout activated the next slot (or a publish happened): claim its turn ping now. Only then,
      // never on every poll (Supabase quota); the cron still sweeps whatever this misses.
      if (publishedNow || timeoutsResolved > 0) scheduleDraftNotifications(pool.id);
      return NextResponse.json<ApiResult<DraftSnapshotDTO | DraftSnapshotUnchanged>>({ success: true, data: dto });
    }

    // Only a running fixed-price draft in turn order can stall; only it reads the pool list for the check.
    const canStall = pool.status === 'in_progress' && pool.pick_order !== 'free' && pool.draft_type === 'budget';
    const [picks, participants, season, poolEntries] = await Promise.all([
      getPicksByPool(id),
      getSeasonParticipants(pool.season_id),
      getSeasonById(pool.season_id),
      canStall ? getPoolEntries(pool.season_id) : Promise.resolve(null),
    ]);

    const isEpb = season ? isEvolutionPointBuy(season.format_type) : false;
    const rules = isEpb ? await getFormatRules(pool.season_id) : null;

    // Seat order is the pool's seeded draw, not the participant read's row order.
    const participantIds = legacySeatOrder(pool.id, participants.map((p) => p.id));
    const totalRounds = resolveTotalRounds(pool, {
      epbDraftPicks: isEpb ? (rules?.draft_picks ?? SQL_DRAFT_PICKS_FALLBACK) : null,
    });

    const state = computeDraftState(pool, picks, participantIds, totalRounds);

    // EPB prices from its bound list, not the pool list: the check covers plain fixed-price pools only.
    const fallbackPrice = pool.default_point_cost ?? 0;
    const stalledPicker = poolEntries !== null && !isEpb
      ? legacyPickerStall({
          state,
          totalRounds,
          availablePrices: availablePricesSorted(poolEntries, state.taken_pokemon, fallbackPrice),
          fallbackPrice,
        })
      : null;

    // The state is computed on the same rows the legacy pick route validates
    // against; only the payload's pick list is narrowed: voided picks dropped
    // and every pick mapped through the public allowlist (no override/void
    // reasons, made_by or client_request_id reach viewers).
    const response: DraftStateResponse = {
      ...state,
      picks: toPublicPicks(state.picks),
      taken_pokemon: Array.from(state.taken_pokemon),
      stalled_picker: stalledPicker,
    };

    if (!isEpb) {
      return NextResponse.json<ApiResult<DraftStateResponse>>({ success: true, data: response });
    }

    // One read per source for the whole season, in one wave. The token ledger
    // is only needed once the pool is complete (purchasable tokens).
    const needsLedger = rules !== null && state.pool.status === 'complete';
    const [trackers, tiers, ledger] = await Promise.all([
      rules !== null || includeTrackers ? getSeasonTrackers(pool.season_id) : Promise.resolve(null),
      includeTrackers ? getAllTiers(pool.season_id) : Promise.resolve(null),
      needsLedger ? loadDraftTokenLedger(pool.season_id, { pool, picks }) : Promise.resolve(null),
    ]);

    if (rules && trackers) {
      response.taken_line_identities = collectTakenLineIdentities(trackers);

      const draftBudget = rules.draft_budget ?? pool.point_budget ?? epbPack.defaults.draftBudget;
      const tokenRatio = rules.draft_token_ratio ?? epbPack.defaults.tokenRatio;
      const tokenMax = rules.draft_token_max ?? epbPack.defaults.tokenMax;
      const maxPicks = rules.draft_picks ?? SQL_DRAFT_PICKS_FALLBACK;

      const picksByPlayer: Record<string, number> = {};
      const purchasableTokensByPlayer: Record<string, number> = {};
      const tokensAllocatedByPlayer: Record<string, boolean> = {};

      for (const pid of participantIds) {
        picksByPlayer[pid] = picks.filter((p) => p.player_id === pid).length;
        if (ledger) {
          tokensAllocatedByPlayer[pid] = hasAllocatedDraftTokensFromLedger(ledger, pid);
          const remaining = computeRemainingPointsFromLedger(ledger, pid, draftBudget, tokenRatio);
          purchasableTokensByPlayer[pid] = computeDraftTokens(remaining, tokenRatio, tokenMax);
        }
      }

      response.epb = {
        draft_budget: draftBudget,
        draft_picks: maxPicks,
        token_ratio: tokenRatio,
        token_max: tokenMax,
        picks_by_player: picksByPlayer,
        purchasable_tokens_by_player: purchasableTokensByPlayer,
        tokens_allocated_by_player: tokensAllocatedByPlayer,
      };
    }

    if (includeTrackers && trackers && tiers) {
      // No tiers is the board's non-evo mode (the old board's tiers check).
      // Trackers without any tier are the missing-tier data error for every
      // line, so they are logged like groupTrackersWithTiers logs one.
      if (tiers.length === 0 && trackers.length > 0) {
        console.error(
          `[api/drafts/state] No evolution tiers in season ${pool.season_id}; ${trackers.length} trackers omitted`,
        );
      }
      response.evolution =
        tiers.length > 0
          ? {
              is_evo_league: true,
              trackers_by_player: groupTrackersWithTiers(
                pool.season_id,
                Object.keys(state.rosters),
                trackers,
                tiers,
              ),
            }
          : { is_evo_league: false, trackers_by_player: {} };
    }

    return NextResponse.json<ApiResult<DraftStateResponse>>({ success: true, data: response });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to compute draft state');
  }
}
