import { after, NextRequest, NextResponse } from 'next/server';
import { AuthError, requireDraftAdmin, requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { effectiveThresholds, type EffectiveThresholds } from '@/lib/draft/line-catalog-data';
import { legacyPickExtrasSchema, queuePickSchema, uuidSchema, type QueuePickInput } from '@/lib/draft/schemas';
import { getDraftSnapshot, type ViewerContext } from '@/lib/draft/snapshot';
import { dispatchDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import {
  getDraftPoolById,
  getPicksByPool,
  createDraftPick,
  updateDraftPoolStatus,
} from '@/lib/supabase/queries/drafts';
import { confirmDraftPick, type ConfirmPickResult } from '@/lib/supabase/queries/drafts-queue';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import {
  computeDraftState,
  validatePick,
  resolveTotalRounds,
  isDraftComplete,
  getRoundForPick,
  rosterCompletionShortfall,
  availablePricesSorted,
  legacySeatOrder,
} from '@/lib/draft/engine';
import { poolFormat } from '@/lib/draft/pool-format';
import { draftPoolFormatLabel } from '@/lib/discord/embeds';
import { isEvoLeague } from '@/lib/draft/evolution-engine';
import { getTierByBasePokemon, createTracker } from '@/lib/supabase/queries/evolutions';
import { getListEntryByLineId } from '@/lib/supabase/queries/point-buy-lists';
import { toPublicPicks, type PublicDraftPick } from '@/lib/draft/public-pick';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { getTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { expireDraftReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ApiResult } from '@/types/api';
import type { SessionPlayer } from '@/types/auth';
import type { DraftPick, DraftPool, MakePickInput } from '@/types/draft';
import type { DraftSnapshotDTO, LineId } from '@/types/draft-queue';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { DraftPoolEntry } from '@/types/draft-pool';
import { draftPickSchema, formatZodErrors } from '@/lib/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** A pick handler's answer plus the season whose public draft reads it changed (expired by POST). */
interface PickOutcome {
  response: NextResponse;
  expireSeasonId: string | null;
}

/** Success body of a queue-engine pick. */
interface QueuePickResponse {
  pick: { pick_id: string; line_id: LineId; pick_number: number; player_id: string; price: number };
  replay: boolean;
  state_version: number;
  /**
   * The fresh snapshot. Absent only when the read after a committed pick failed:
   * the pick stands, and the client refreshes the state instead.
   */
  snapshot?: DraftSnapshotDTO;
}

/**
 * GET /api/drafts/[id]/picks — the pool's standing picks (voided picks
 * dropped), mapped through the public allowlist in `@/lib/draft/public-pick`.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requirePlayer();
    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      throw new UserFacingError('Draft pool not found', { code: 'POOL_NOT_FOUND', status: 404 });
    }
    const picks = toPublicPicks(await getPicksByPool(id));
    return NextResponse.json<ApiResult<PublicDraftPick[]>>({ success: true, data: picks });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch picks');
  }
}

/** A legacy failure: the English text is unchanged; the code (and params) come from `errors/draft` (§9.2). */
function legacyError(
  error: string,
  code: ApiErrorCode,
  status: number,
  params?: Record<string, string | number>,
): PickOutcome {
  return {
    response: NextResponse.json<ApiResult<never>>({ success: false, error, code, params }, { status }),
    expireSeasonId: null,
  };
}

/**
 * Authorization of an act that needs pool-admin rights (an on-behalf pick): site
 * admin, or a live resource-admin read for the pool's season. The session's
 * `isResourceAdmin` copy can be stale (a grant revoked since sign-in, or one made
 * since), so it never decides; callers run this only where the right is needed.
 */
async function viewerIsPoolAdmin(player: SessionPlayer, seasonId: string): Promise<boolean> {
  if (player.isAdmin) return true;
  return isResourceAdminFor(player.playerId, 'season', seasonId);
}

/**
 * Admin view of a snapshot answered to a self pick (display only, like the state
 * route): the resource read runs only when the session says resource admin, so a
 * plain self pick keeps its query budget. Never an authorization.
 */
async function viewerSeesPoolAdmin(player: SessionPlayer, seasonId: string): Promise<boolean> {
  if (player.isAdmin) return true;
  return player.isResourceAdmin === true && (await isResourceAdminFor(player.playerId, 'season', seasonId));
}

async function fullSnapshot(poolId: string, viewer: ViewerContext): Promise<{ dto: DraftSnapshotDTO; publishedNow: boolean }> {
  const { dto, publishedNow } = await getDraftSnapshot(poolId, viewer);
  if ('unchanged' in dto) throw new Error('draft_snapshot answered unchanged without since');
  return { dto, publishedNow };
}

/**
 * Discord/social notifications of a queue-engine pick, run after the response
 * (`after()`). Payloads carry canonical English names; the embed picks the
 * webhook's language. Failures are logged and never reach the pick.
 */
async function notifyQueuePick(
  pool: DraftPool,
  result: ConfirmPickResult,
  snapshot: DraftSnapshotDTO,
  entry: PointBuyListEntry | null,
): Promise<void> {
  const [season, lineEntry] = await Promise.all([
    getSeasonById(pool.season_id),
    entry ?? (pool.list_version_id ? getListEntryByLineId(pool.list_version_id, result.line_id) : Promise.resolve(null)),
  ]);
  if (!season) return;

  const nameOf = (playerId: string) => snapshot.participants.find((p) => p.player_id === playerId)?.name;
  const nextPlayerId = result.completed ? null : (snapshot.active_slot?.player_id ?? null);
  const nextPlayer = nextPlayerId ? await getPlayerById(nextPlayerId) : null;

  const pickPayload = {
    event_type: 'draft_pick_made' as const,
    tournament_id: '', // drafts are season-scoped
    season_id: pool.season_id,
    data: {
      kind: 'draft_pick' as const,
      player_name: nameOf(result.player_id) ?? '',
      pokemon_name: lineEntry?.base_pokemon ?? result.line_id,
      pick_number: result.pick_number,
      round: snapshot.picks.find((p) => p.pick_id === result.pick_id)?.round ?? 0,
      season_name: season.name,
      next_picker_name: nextPlayerId ? (nextPlayer?.name ?? nameOf(nextPlayerId)) : undefined,
      // Email-only players have no Discord ID: the embed skips the @mention.
      next_picker_discord_id: nextPlayer?.discord_id ?? undefined,
      // Canonical English line names; the embed shows the localized line label (§11.3).
      line: lineEntry ? { base: lineEntry.base_pokemon, stage3: lineEntry.stage3_pokemon } : undefined,
    },
  };
  void emitDiscordEvent(pickPayload);
  void emitSocialEvent(pickPayload);

  if (result.completed) {
    const donePayload = {
      event_type: 'draft_completed' as const,
      tournament_id: '',
      season_id: pool.season_id,
      data: draftCompletedData(pool, season.name),
    };
    void emitDiscordEvent(donePayload);
    void emitSocialEvent(donePayload);
  }
}

/**
 * Queue-engine pick: one `draft_confirm_pick` RPC that
 * re-validates everything under the season lock, then the fresh snapshot. A
 * rule error answers with its code and the current snapshot; a replayed
 * `client_request_id` answers 200 with the first result.
 */
async function queuePick(player: SessionPlayer, pool: DraftPool, rawBody: unknown): Promise<PickOutcome> {
  const body: QueuePickInput = queuePickSchema.parse(rawBody);
  const onBehalf = body.on_behalf_of !== undefined && body.on_behalf_of !== player.playerId;
  let viewer: ViewerContext = { playerId: player.playerId, isPoolAdmin: false };

  try {
    if (onBehalf) {
      try {
        await requireDraftAdmin(pool.id);
      } catch (authErr) {
        // Picking for someone else without draft-admin rights: same status, the §9.1 code.
        if (authErr instanceof AuthError) {
          throw new UserFacingError(authErr.message, { code: 'ACTOR_NOT_ALLOWED', status: authErr.statusCode });
        }
        throw authErr;
      }
      viewer = { playerId: player.playerId, isPoolAdmin: true };
      if (!body.override_reason) throw new DraftRuleError('OVERRIDE_REASON_REQUIRED');
    } else {
      viewer = { playerId: player.playerId, isPoolAdmin: await viewerSeesPoolAdmin(player, pool.season_id) };
    }

    // Redraft picks transfer kills at the new line's (override-aware) thresholds; SQL needs them passed in.
    let entry: PointBuyListEntry | null = null;
    let thresholds: EffectiveThresholds | null = null;
    if (pool.kind === 'redraft') {
      if (!pool.list_version_id) throw new DraftRuleError('SEASON_HAS_NO_LIST');
      entry = await getListEntryByLineId(pool.list_version_id, body.line_id);
      if (!entry) throw new DraftRuleError('NOT_IN_LIST');
      thresholds = effectiveThresholds(entry);
    }

    const result = await confirmDraftPick({
      poolId: pool.id,
      slotId: body.slot_id,
      playerId: onBehalf && body.on_behalf_of ? body.on_behalf_of : player.playerId,
      actorId: player.playerId,
      actorRole: onBehalf ? 'admin' : 'player',
      lineId: body.line_id,
      clientRequestId: body.client_request_id,
      redraftSlotId: body.redraft_slot_id ?? null,
      lineThresholds: thresholds,
      overrideReason: body.override_reason ?? null,
    });

    // §8.3 step 5: the pick is committed. Expire the league's public draft reads and schedule the
    // notifications BEFORE the snapshot read, so a failing read cannot skip either.
    expireDraftReads(pool.season_id);
    let committedSnapshot: DraftSnapshotDTO | null = null;
    if (!result.replay) {
      after(async () => {
        try {
          const snapshot = committedSnapshot ?? (await fullSnapshot(pool.id, viewer)).dto;
          await notifyQueuePick(pool, result, snapshot, entry);
        } catch (err) {
          console.error('[api/drafts/picks] pick notification failed:', err);
        }
        // The next slot's turn ping (slow drafts) goes out now, not at the next cron run (§8.3, B-CRON).
        // Awaited inside after() so its reads finish before the function is frozen; the Discord posts
        // themselves stay fire-and-forget, and dispatch never throws.
        try {
          await dispatchDraftNotifications(await callDraftRpc('draft_claim_notifications', { p_pool_id: pool.id }));
        } catch (err) {
          console.error('[api/drafts/picks] claiming draft notifications failed:', err);
        }
      });
    }

    // The committed pick is the answer even when the snapshot read fails (the client refreshes).
    try {
      committedSnapshot = (await fullSnapshot(pool.id, viewer)).dto;
    } catch (snapErr) {
      console.error('[api/drafts/picks] snapshot after a committed pick failed:', snapErr);
    }

    const data: QueuePickResponse = {
      pick: {
        pick_id: result.pick_id,
        line_id: result.line_id,
        pick_number: result.pick_number,
        player_id: result.player_id,
        price: result.price,
      },
      replay: result.replay,
      state_version: committedSnapshot ? Math.max(result.state_version, committedSnapshot.state_version) : result.state_version,
    };
    if (committedSnapshot) data.snapshot = committedSnapshot;
    // Draft reads were expired above, right after the commit.
    return {
      response: NextResponse.json<ApiResult<QueuePickResponse>>({ success: true, data }, { status: result.replay ? 200 : 201 }),
      expireSeasonId: null,
    };
  } catch (err) {
    if (!(err instanceof DraftRuleError)) throw err;
    // SPEC:1016-1022: a refused pick answers with the current state, so the client can re-render at once.
    let snapshot: DraftSnapshotDTO | undefined;
    let publishedNow = false;
    try {
      ({ dto: snapshot, publishedNow } = await fullSnapshot(pool.id, viewer));
    } catch (snapErr) {
      console.error('[api/drafts/picks] snapshot after a refused pick failed:', snapErr);
    }
    return {
      response: draftErrorResponse(err, 'Failed to make pick', snapshot ? { snapshot } : undefined),
      expireSeasonId: publishedNow ? pool.season_id : null,
    };
  }
}

/** The `draft_completed` payload: the pool's order and pricing, plus their English label as `pool_name`. */
function draftCompletedData(pool: DraftPool, seasonName: string) {
  const format = poolFormat(pool);
  return {
    kind: 'draft_completed' as const,
    season_name: seasonName,
    pool_name: draftPoolFormatLabel(format, 'en'),
    pool_format: format,
  };
}

function findPoolEntry(entries: readonly DraftPoolEntry[], pokemonName: string): DraftPoolEntry | undefined {
  const name = pokemonName.toLowerCase();
  return entries.find((e) => e.pokemon_name.toLowerCase() === name);
}

/**
 * Server-side price of a non-EPB legacy pick. Snake pools and pools without a
 * budget store no points. Otherwise the client's value is checked, never
 * trusted: a `budget` pool's fixed price is the entry's `point_cost`, else the
 * pool's `default_point_cost`, else 0 (the price the teambuilder shows); another
 * value is refused and no value means that price. An `auction` bid must reach
 * the entry's `point_cost` (the reserve; `default_point_cost` is no reserve) and
 * always at least 1, so a bid is never free and never adds budget.
 */
function legacyPickCost(
  pool: Pick<DraftPool, 'draft_type' | 'point_budget' | 'default_point_cost'>,
  entry: Pick<DraftPoolEntry, 'point_cost'> | undefined,
  clientPoints: number | null | undefined,
): { points: number | null } | { issues: string } {
  // Snake drafts never spend points (the pick form sends none), even when a budget is stored on the pool.
  if (pool.draft_type === 'snake' || (pool.point_budget ?? null) === null) return { points: null };
  const sent = clientPoints ?? null;
  if (pool.draft_type === 'budget') {
    const price = entry?.point_cost ?? pool.default_point_cost ?? 0;
    if (sent !== null && sent !== price) return { issues: `points_spent: this pick costs ${price}` };
    return { points: price };
  }
  const minimum = Math.max(1, entry?.point_cost ?? 1);
  if (sent === null || sent < minimum) {
    return { issues: `points_spent: a bid of at least ${minimum} is required` };
  }
  return { points: sent };
}

/**
 * Legacy-engine pick (pools created before the queue engine): unchanged rules,
 * with an `errors/draft` code on every failure (§9.2; English text and HTTP
 * status unchanged).
 *
 * A point-buy (EPB) season drafts only through the queue engine, whose pool
 * completability gate guarantees a legal pick always exists: a legacy pool of
 * an EPB season answers `409 POOL_ENGINE_LEGACY_EPB` before any pick rule runs,
 * so no legacy pick (and no evolution tracker) is ever created for such a season.
 */
async function legacyPick(player: SessionPlayer, pool: DraftPool, rawBody: unknown): Promise<PickOutcome> {
  const id = pool.id;
  const zodResult = draftPickSchema.safeParse(rawBody);
  if (!zodResult.success) {
    const issues = formatZodErrors(zodResult.error);
    return legacyError(issues, 'validation_failed', 400, { issues });
  }
  // `player_id` must be a uuid and `points_spent` a non-negative integer; neither is trusted further.
  const extrasResult = legacyPickExtrasSchema.safeParse(rawBody);
  if (!extrasResult.success) {
    const issues = formatZodErrors(extrasResult.error);
    return legacyError(issues, 'validation_failed', 400, { issues });
  }
  const body = { ...zodResult.data, ...extrasResult.data };

  const [picks, participants, season, poolEntries] = await Promise.all([
    getPicksByPool(id),
    getSeasonParticipants(pool.season_id),
    getSeasonById(pool.season_id),
    getPoolEntries(pool.season_id),
  ]);
  if (season && isEvolutionPointBuy(season.format_type)) throw new DraftRuleError('POOL_ENGINE_LEGACY_EPB');

  const totalRounds = resolveTotalRounds(pool);

  // Seat order is the pool's seeded draw, not the participant read's row order.
  const participantIds = legacySeatOrder(id, participants.map((p) => p.id));
  const state = computeDraftState(pool, picks, participantIds, totalRounds);

  // Determine who is making the pick
  const pickPlayerId = body.player_id ?? player.playerId;
  const onBehalf = pickPlayerId !== player.playerId;

  // Admins (site-wide or season resource admin) can pick on behalf of others
  if (onBehalf && !(await viewerIsPoolAdmin(player, pool.season_id))) {
    return legacyError('You can only make picks for yourself', 'ACTOR_NOT_ALLOWED', 403);
  }
  if (!participantIds.includes(pickPlayerId)) {
    // A self pick (no `player_id` sent) by a non-participant is about the caller, not a field.
    const issues = body.player_id === undefined
      ? 'You are not a participant of this league'
      : 'player_id: not a participant of this league';
    return legacyError(issues, 'validation_failed', 400, { issues });
  }

  const poolEntry = findPoolEntry(poolEntries, body.pokemon_name);
  // The server prices the pick: budget pools from the pool entry's cost (or the pool default),
  // auctions from a checked bid; pools without a budget store no points.
  const cost = legacyPickCost(pool, poolEntry, body.points_spent);

  const input: MakePickInput = {
    draft_pool_id: id,
    player_id: pickPlayerId,
    pokemon_name: body.pokemon_name,
    stage3_pokemon: body.stage3_pokemon ?? null,
    points_spent: 'points' in cost ? cost.points : null,
  };

  // Snake and linear order enforce the turn; free order lets anyone pick (admins on behalf of anyone).
  const enforceOrder = state.turn_enforced;
  const validationError = validatePick(state, input, enforceOrder);
  if (validationError) {
    return {
      response: NextResponse.json<ApiResult<never>>(
        { success: false, error: validationError.message, code: validationError.code },
        { status: 400 }
      ),
      expireSeasonId: null,
    };
  }
  // Every player drafts at most `totalRounds` Pokémon. Turn order guarantees it; free order does not (with no
  // budget to run out, one player could otherwise take the whole pool).
  const pickerPickCount = picks.filter((p) => p.player_id === pickPlayerId).length;
  if (pickerPickCount >= totalRounds) {
    return legacyError(`This player already has all ${totalRounds} picks`, 'draft_roster_full', 400, {
      max: totalRounds,
    });
  }
  // ── Pool entry enforcement (universal — all draft types) ───────
  const hasPool = poolEntries.length > 0;

  if (hasPool) {
    // Check the picked Pokémon is in the draft pool
    if (!poolEntry) {
      // For evo-leagues, also check wildcards assigned to this player
      const wildcardTier = (await isEvoLeague(pool.season_id))
        ? await getTierByBasePokemon(pool.season_id, body.pokemon_name, pickPlayerId)
        : null;
      if (!wildcardTier) {
        return legacyError(`${body.pokemon_name} is not in the draft pool`, 'NOT_IN_POOL', 400, {
          pokemon: body.pokemon_name,
        });
      }
    }

    // Enforce tier limits (if any exist)
    if (poolEntry?.power_tier) {
      const limits = await getTierLimits(pool.season_id);
      const tierLimit = limits.find((l) => l.power_tier === poolEntry.power_tier);
      if (tierLimit && tierLimit.max_picks > 0) {
        const playerPicks = picks.filter((p) => p.player_id === pickPlayerId);
        const tierCount = playerPicks.filter((p) => {
          const entry = findPoolEntry(poolEntries, p.pokemon_name);
          return entry && entry.power_tier === poolEntry.power_tier;
        }).length;

        if (tierCount >= tierLimit.max_picks) {
          return legacyError(
            `${poolEntry.power_tier}-tier limit reached (max ${tierLimit.max_picks})`,
            'TIER_LIMIT_REACHED',
            400,
            { tier: poolEntry.power_tier, max: tierLimit.max_picks },
          );
        }
      }
    }
  }

  // Turn and availability first (validatePick), then the pool entry rules above, and only then a
  // refused price (validatePick saw no points for it).
  if ('issues' in cost) {
    return legacyError(cost.issues, 'validation_failed', 400, { issues: cost.issues });
  }

  // Fixed costs with turn order: a pick that leaves the picker unable to fill their remaining rounds would
  // stall the draft on their turn, so it is refused. Best effort: it sees today's prices, so other players can
  // still take the cheap Pokémon before the picker's next turn; the board then reports the stall and an admin
  // switches the pool to free order (`/free-order`). Free order has no turn to stall.
  if (enforceOrder && pool.draft_type === 'budget' && state.budgets && input.points_spent != null) {
    const fallbackPrice = pool.default_point_cost ?? 0;
    const otherPricesSorted = availablePricesSorted(poolEntries, state.taken_pokemon, fallbackPrice, poolEntry);
    const shortfall = rosterCompletionShortfall({
      remaining: state.budgets[pickPlayerId] ?? 0,
      price: input.points_spent,
      slotsAfter: totalRounds - pickerPickCount - 1,
      otherPricesSorted,
      fallbackPrice,
    });
    if (shortfall) {
      return legacyError(
        `After this pick only ${shortfall.remaining_after} points would be left, but the remaining ${shortfall.slots} picks cost at least ${shortfall.min_cost} points.`,
        'draft_pick_strands_roster',
        400,
        { ...shortfall },
      );
    }
  }

  const round = getRoundForPick(state.next_pick_number, participantIds.length);

  const pick = await createDraftPick({ ...input, pick_number: state.next_pick_number, round });

  // An admin pick for another player is audited (fire-and-forget; never blocks the pick).
  if (onBehalf) {
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'draft.pick.on_behalf',
      resource_type: 'draft_pool',
      resource_id: id,
      metadata: {
        season_id: pool.season_id,
        target_player_id: pickPlayerId,
        pick_id: pick.id,
        pokemon_name: pick.pokemon_name,
        stage3_pokemon: input.stage3_pokemon,
        points_spent: input.points_spent,
      },
    });
  }

  // Legacy evo-leagues (evolution_tiers) get a tracker for a tiered Pokémon.
  if (await isEvoLeague(pool.season_id)) {
    const tier = await getTierByBasePokemon(pool.season_id, body.pokemon_name, pickPlayerId)
      ?? await getTierByBasePokemon(pool.season_id, body.pokemon_name);
    if (tier) {
      await createTracker({
        season_id: pool.season_id,
        player_id: pickPlayerId,
        base_pokemon: body.pokemon_name,
      });
    }
  }

  // Auto-complete draft if all picks are made
  const draftDone = isDraftComplete(state.next_pick_number, participantIds.length, totalRounds);
  if (draftDone) {
    await updateDraftPoolStatus(id, 'complete');
  }

  // Discord notifications (fire-and-forget). The pick is committed: a failure
  // here is logged and never turns the response into an error.
  try {
    // Season already loaded above; fetch the picking player's name for the embed
    const pickPlayer = await getPlayerById(pickPlayerId);
    if (season) {
      // Determine who picks next (for @mention notification)
      let nextPickerName: string | undefined;
      let nextPickerDiscordId: string | undefined;
      // Free order has no next picker: its display suggestion is never announced or pinged.
      if (!draftDone && state.turn_enforced) {
        const updatedPicks = await getPicksByPool(id);
        const nextState = computeDraftState(pool, updatedPicks, participantIds, totalRounds);
        if (nextState.current_picker) {
          const nextPlayer = await getPlayerById(nextState.current_picker);
          if (nextPlayer) {
            nextPickerName = nextPlayer.name;
            // Email-only players have no Discord ID — embed builder skips the @mention
            nextPickerDiscordId = nextPlayer.discord_id ?? undefined;
          }
        }
      }

      // Use empty string for tournament_id — drafts are season-scoped
      const pickPayload = {
        event_type: 'draft_pick_made' as const,
        tournament_id: '',  // no tournament — resolved via season scope
        season_id: pool.season_id,
        data: {
          kind: 'draft_pick' as const,
          player_name: pickPlayer?.name ?? 'Unknown',
          pokemon_name: body.pokemon_name,
          pick_number: state.next_pick_number,
          round,
          season_name: season.name,
          next_picker_name: nextPickerName,
          next_picker_discord_id: nextPickerDiscordId,
        },
      };
      void emitDiscordEvent(pickPayload);
      void emitSocialEvent(pickPayload);

      if (draftDone) {
        const draftDonePayload = {
          event_type: 'draft_completed' as const,
          tournament_id: '',
          season_id: pool.season_id,
          data: draftCompletedData(pool, season.name),
        };
        void emitDiscordEvent(draftDonePayload);
        void emitSocialEvent(draftDonePayload);
      }
    }
  } catch (err) {
    console.error('[api/drafts/picks] pick notification failed:', err);
  }

  return {
    response: NextResponse.json<ApiResult<DraftPick>>({ success: true, data: pick }, { status: 201 }),
    expireSeasonId: pool.season_id,
  };
}

/**
 * POST /api/drafts/[id]/picks — make a draft pick
 *
 * Queue-engine pools: `{ slot_id, line_id,
 * client_request_id, redraft_slot_id?, on_behalf_of?, override_reason? }`;
 * picking for another player needs the draft admin guard and a reason.
 *
 * Legacy pools: `{ player_id, pokemon_name, stage3_pokemon?, points_spent? }`;
 * for snake drafts the requesting player must be the current picker, OR an
 * admin can pick on behalf of a player.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;

    // A malformed id is a missing pool, not a database error. The path id is checked before the body is read.
    const pool = uuidSchema.safeParse(id).success ? await getDraftPoolById(id) : null;
    if (!pool) {
      throw new UserFacingError('Draft pool not found', { code: 'POOL_NOT_FOUND', status: 404 });
    }
    const rawBody: unknown = await request.json();

    const outcome = pool.engine === 'queue'
      ? await queuePick(player, pool, rawBody)
      : await legacyPick(player, pool, rawBody);
    // The pick shows on the league page's next view, even after an idle spell
    // (also when a refused pick's snapshot tick published a redraft).
    if (outcome.expireSeasonId) expireDraftReads(outcome.expireSeasonId);
    return outcome.response;
  } catch (err) {
    return draftErrorResponse(err, 'Failed to make pick');
  }
}
