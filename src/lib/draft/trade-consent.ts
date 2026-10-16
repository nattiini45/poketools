/**
 * Shared logic for the EPB trade-consent flow (3B-2-a).
 *
 * The swap engine itself lives in redraft-engine.ts (prepareRedraftSwap) and
 * redraft-trade-requests.ts (executeTradeRequest RPC) — this module does NOT duplicate it.
 * It only resolves the two trade sides and persists the pending consent
 * request, so both the dedicated create endpoint and the legacy redraft
 * POST trade branch can delegate to one place and never bypass consent.
 */

import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { isRedraftExcluded } from '@/lib/draft/special-rules';
import { entryForTracker } from '@/lib/draft/point-buy-pool';
import { createTradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { TradeRequest } from '@/lib/supabase/queries/redraft-trade-requests';
import type { ApiErrorCode, ApiErrorParams } from '@/i18n/messages/errors';

export interface ResolvedTradeSide {
  player_id: string;
  from_tracker_id: string;
  line: string;
  entry: PointBuyListEntry;
}

export interface ResolveTradeSidesResult {
  sideA: ResolvedTradeSide;
  sideB: ResolvedTradeSide;
}

/**
 * Domain error for the trade-consent flow. Messages are user-facing by
 * design; extends UserFacingError so safeErrorResponse() passes the message
 * and status through (and logs it server-side) — routes must NOT hand-patch
 * a NextResponse per CLAUDE.md's error-handling pattern.
 */
export class TradeConsentError<C extends ApiErrorCode = ApiErrorCode> extends UserFacingError<C> {
  constructor(message: string, status = 400, opts: { code?: C; params?: ApiErrorParams<C> } = {}) {
    super(message, { status, code: opts.code, params: opts.params });
    this.name = 'TradeConsentError';
  }
}

/**
 * Resolve and validate both sides of a trade from source tracker ids:
 *  - both trackers must exist in this season
 *  - tracker_a belongs to player_a_id, tracker_b to player_b_id
 *  - both lines exist in the bound list
 *  - neither line is redraft-excluded (`isRedraftExcluded`)
 *
 * Raises TradeConsentError (4xx) on any failure. listVersionId is needed to
 * look up entries by base_pokemon.
 */
export async function resolveTradeSides(
  seasonId: string,
  playerAId: string,
  fromTrackerAId: string,
  playerBId: string,
  fromTrackerBId: string,
  listVersionId: string
): Promise<ResolveTradeSidesResult> {
  const [trackers, entries] = await Promise.all([
    getSeasonTrackers(seasonId),
    getListEntries(listVersionId),
  ]);

  const trackerA = trackers.find((t) => t.id === fromTrackerAId);
  if (!trackerA) {
    throw new TradeConsentError('Source tracker for player A not found', 404, {
      code: 'trade_source_tracker_not_found',
      params: { side: 'A' },
    });
  }
  if (trackerA.player_id !== playerAId) {
    throw new TradeConsentError('The offered line A does not belong to player A', 403, {
      code: 'trade_line_not_owned',
      params: { side: 'A' },
    });
  }

  const trackerB = trackers.find((t) => t.id === fromTrackerBId);
  if (!trackerB) {
    throw new TradeConsentError('Source tracker for player B not found', 404, {
      code: 'trade_source_tracker_not_found',
      params: { side: 'B' },
    });
  }
  if (trackerB.player_id !== playerBId) {
    throw new TradeConsentError('The offered line B does not belong to player B', 403, {
      code: 'trade_line_not_owned',
      params: { side: 'B' },
    });
  }

  // Lines are matched by line_id (a base can have two branches); legacy
  // trackers without a line id fall back to base + locked stage 3.
  const entryA = entryForTracker(trackerA, entries);
  if (!entryA) {
    throw new TradeConsentError('The offered line A is not part of the bound point-buy list', 400, {
      code: 'trade_line_not_in_list',
      params: { side: 'A' },
    });
  }
  const entryB = entryForTracker(trackerB, entries);
  if (!entryB) {
    throw new TradeConsentError('The offered line B is not part of the bound point-buy list', 400, {
      code: 'trade_line_not_in_list',
      params: { side: 'B' },
    });
  }

  // Redraft-lock exclusion (both ways) — reuse the same rule the swap engine uses.
  if (isRedraftExcluded(entryA.base_pokemon, entryA.special_rules)) {
    throw new TradeConsentError(`${entryA.base_pokemon} cannot be traded`, 400, {
      code: 'trade_line_untradeable',
      params: { pokemon: entryA.base_pokemon },
    });
  }
  if (isRedraftExcluded(entryB.base_pokemon, entryB.special_rules)) {
    throw new TradeConsentError(`${entryB.base_pokemon} cannot be traded`, 400, {
      code: 'trade_line_untradeable',
      params: { pokemon: entryB.base_pokemon },
    });
  }

  return {
    sideA: {
      player_id: playerAId,
      from_tracker_id: trackerA.id,
      line: trackerA.base_pokemon,
      entry: entryA,
    },
    sideB: {
      player_id: playerBId,
      from_tracker_id: trackerB.id,
      line: trackerB.base_pokemon,
      entry: entryB,
    },
  };
}

/**
 * Create a PENDING trade request from two resolved sides. The
 * one-pending-per-tracker rule is enforced by the partial unique index; a
 * violation (23505) is surfaced as a TradeConsentError (409).
 */
export async function createPendingTradeRequest(
  seasonId: string,
  initiatedBy: string,
  sides: ResolveTradeSidesResult
): Promise<TradeRequest> {
  try {
    return await createTradeRequest({
      season_id: seasonId,
      initiated_by: initiatedBy,
      player_a_id: sides.sideA.player_id,
      from_tracker_a_id: sides.sideA.from_tracker_id,
      line_a: sides.sideA.line,
      player_b_id: sides.sideB.player_id,
      from_tracker_b_id: sides.sideB.from_tracker_id,
      line_b: sides.sideB.line,
    });
  } catch (err) {
    // Partial unique index violation: one of these lines already has a pending trade.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505') {
      throw new TradeConsentError('One of these lines already has a pending trade', 409, {
        code: 'trade_line_pending',
      });
    }
    // Foreign-key violation (23503): a source tracker was deleted between the
    // resolveTradeSides ownership check and this INSERT (the from_tracker_*_id
    // FKs are validated at insert time). Surface as a 409 instead of a 500 so
    // the caller can tell the user the line is gone rather than retry blindly.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23503') {
      throw new TradeConsentError('A selected line is no longer available', 409, {
        code: 'trade_line_gone',
      });
    }
    throw err;
  }
}

/**
 * Helper for routes: load the two source trackers fresh (post-consent, at
 * execute time) so the swap engine validates against the CURRENT state, not a
 * stale snapshot. Returns the trackers + their list entries, or throws
 * TradeConsentError if either side is gone.
 */
export async function loadTradeSidesFresh(
  seasonId: string,
  request: TradeRequest,
  listVersionId: string
): Promise<{
  trackerA: EvolutionTracker;
  trackerB: EvolutionTracker;
  entryA: PointBuyListEntry;
  entryB: PointBuyListEntry;
}> {
  const [trackers, entries] = await Promise.all([
    getSeasonTrackers(seasonId),
    getListEntries(listVersionId),
  ]);

  const trackerA = trackers.find((t) => t.id === request.from_tracker_a_id);
  if (!trackerA) {
    throw new TradeConsentError('Source tracker for player A is no longer available', 409, {
      code: 'trade_source_tracker_unavailable',
    });
  }
  const trackerB = trackers.find((t) => t.id === request.from_tracker_b_id);
  if (!trackerB) {
    throw new TradeConsentError('Source tracker for player B is no longer available', 409, {
      code: 'trade_source_tracker_unavailable',
    });
  }
  const entryA = entryForTracker(trackerA, entries);
  const entryB = entryForTracker(trackerB, entries);
  if (!entryA || !entryB) {
    throw new TradeConsentError('A traded line is no longer part of the bound point-buy list', 409, {
      code: 'trade_line_left_list',
    });
  }
  return { trackerA, trackerB, entryA, entryB };
}