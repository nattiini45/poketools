/**
 * One DraftBoard poll: a single GET /api/drafts/[id]/state (with
 * `?include=trackers` for EPB boards) plus the evolution-event diff against
 * the previous poll's trackers.
 *
 * Extracted from DraftBoard.tsx so the per-tick request count and the event
 * detection are testable without a DOM. Before DATA-PLAN fix 2 each tick made
 * 2 + P requests (state, tiers, one trackers call per player).
 */

import type { PublicDraftPick } from '@/lib/draft/public-pick';
import type { EvolutionEvent, EvolutionTrackerWithTier } from '@/types/evolution';
import { outcomeForPoolStatus, type PollOutcome } from '@/lib/draft/use-visible-poll';
import type { ApiErrorLike } from '@/i18n/api-errors';

/** player_id → that player's trackers with tiers. */
export type TrackersByPlayer = Record<string, EvolutionTrackerWithTier[]>;

/** Serialized DraftState from the state API (Set → array). */
export interface DraftBoardState {
  pool: {
    id: string;
    season_id: string;
    /** Pricing: snake = no points, budget = fixed costs, auction = bids. */
    draft_type: 'snake' | 'auction' | 'budget';
    /** Turn order (legacy pools); `turn_enforced` says whether it is enforced. */
    pick_order: 'snake' | 'linear' | 'free';
    point_budget: number | null;
    /** Price of a budget-draft entry without its own point_cost (the server charges the same). */
    default_point_cost?: number | null;
    status: 'pending' | 'in_progress' | 'complete';
    created_at: string;
    updated_at: string;
  };
  /** Public pick shape (the state route strips admin correction data and voided picks). */
  picks: PublicDraftPick[];
  rosters: Record<string, string[]>;
  budgets: Record<string, number> | null;
  /** This round's seat order. */
  pick_order: string[];
  /** Next picker; only a display suggestion when `turn_enforced` is false. */
  current_picker: string | null;
  /** False for free order: no "your turn", anyone picks, admins enter picks for anyone. */
  turn_enforced: boolean;
  /**
   * Snake/linear order with fixed prices: the current picker cannot afford a pick that completes their roster
   * (the draft is stuck until an admin switches to free order). Absent from older servers; null otherwise.
   */
  stalled_picker?: { player_id: string; remaining: number; open_slots: number; min_cost: number } | null;
  next_pick_number: number;
  current_round: number;
  taken_pokemon: string[];
  /** EPB: server-computed drafted line identities (base|stage3) */
  taken_line_identities?: string[];
  epb?: {
    draft_budget: number;
    draft_picks: number;
    token_ratio: number;
    token_max: number;
    picks_by_player: Record<string, number>;
    purchasable_tokens_by_player: Record<string, number>;
    tokens_allocated_by_player: Record<string, boolean>;
  };
  /** EPB + include=trackers: trackers with tiers, folded into the state poll. */
  evolution?: {
    is_evo_league: boolean;
    trackers_by_player: TrackersByPlayer;
  };
}

export type DraftBoardPoll =
  | {
      kind: 'state';
      state: DraftBoardState;
      /** Set when the season is an evo league: the new trackers and any events. */
      evolution: { trackers: TrackersByPlayer; events: EvolutionEvent[] } | null;
      outcome: PollOutcome;
    }
  | {
      kind: 'error';
      /** The server's English `error`, or `DRAFT_STATE_LOAD_ERROR` when the request itself failed. */
      error: string;
      /** The server's error code and params (present only when the server sent a code). */
      code?: string;
      params?: Record<string, string | number>;
      outcome: PollOutcome;
    }
  | { kind: 'aborted' };

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/**
 * The English fallback when the state request fails without a server error
 * (network, unreadable body). DraftBoard renders its own translation for it
 * (`draft/legacy/board.errors.loadState`); the string itself stays English.
 */
export const DRAFT_STATE_LOAD_ERROR = 'Failed to load draft state';
const LOAD_ERROR = DRAFT_STATE_LOAD_ERROR;

export function draftBoardStateUrl(poolId: string, withTrackers: boolean): string {
  const base = `/api/drafts/${encodeURIComponent(poolId)}/state`;
  return withTrackers ? `${base}?include=trackers` : base;
}

/**
 * Evolution (or de-evolution) events between two polls: a line whose
 * current_form changed for the same player.
 */
export function detectEvolutionEvents(
  previous: TrackersByPlayer,
  next: TrackersByPlayer,
): EvolutionEvent[] {
  const events: EvolutionEvent[] = [];
  for (const [playerId, trackers] of Object.entries(next)) {
    const previousTrackers = previous[playerId] ?? [];
    for (const tracker of trackers) {
      const prev = previousTrackers.find((t) => t.base_pokemon === tracker.base_pokemon);
      if (prev && prev.current_form !== tracker.current_form) {
        events.push({
          player_id: playerId,
          base_pokemon: tracker.base_pokemon,
          previous_form: prev.current_form,
          new_form: tracker.current_form,
          new_stage: tracker.current_stage,
          total_kos: tracker.total_kos,
          is_devolution: tracker.current_stage < prev.current_stage,
        });
      }
    }
  }
  return events;
}

/**
 * Run one poll. Exactly one HTTP request. `previousTrackers` must be the
 * trackers from the last successful poll (DraftBoard keeps them in a ref).
 * 401/403 report `'stop'`: a signed-out or blocked viewer cannot read the
 * state API, so polling on is pure cost.
 */
export async function pollDraftBoard({
  fetchImpl,
  poolId,
  withTrackers,
  previousTrackers,
  signal,
}: {
  fetchImpl: FetchLike;
  poolId: string;
  withTrackers: boolean;
  previousTrackers: TrackersByPlayer;
  signal?: AbortSignal;
}): Promise<DraftBoardPoll> {
  try {
    const res = await fetchImpl(draftBoardStateUrl(poolId, withTrackers), { signal });
    const authBlocked = res.status === 401 || res.status === 403;
    const json = (await res.json()) as {
      success: boolean;
      data?: DraftBoardState;
      error?: string;
      code?: unknown;
      params?: unknown;
    };

    if (!json.success || !json.data) {
      return {
        kind: 'error',
        error: json.error ?? LOAD_ERROR,
        ...errorDetail(json.code, json.params),
        outcome: authBlocked ? 'stop' : 'live',
      };
    }

    const evo = json.data.evolution;
    const evolution =
      evo && evo.is_evo_league
        ? {
            trackers: evo.trackers_by_player,
            events: detectEvolutionEvents(previousTrackers, evo.trackers_by_player),
          }
        : null;

    return {
      kind: 'state',
      state: json.data,
      evolution,
      outcome: outcomeForPoolStatus(json.data.pool.status),
    };
  } catch (err) {
    if (signal?.aborted) return { kind: 'aborted' };
    console.error('[DraftBoard] fetch state failed:', err);
    return { kind: 'error', error: LOAD_ERROR, outcome: 'live' };
  }
}

/** The `code` / `params` of an error body, only when the server sent a string code. */
function errorDetail(code: unknown, params: unknown): { code?: string; params?: Record<string, string | number> } {
  if (typeof code !== 'string' || code === '') return {};
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return { code };
  const clean: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value;
  }
  return { code, params: clean };
}

/**
 * Whether the EPB board points the viewer to the token centre to buy
 * Draft Kill Tokens: the pool is complete and, per the server, the viewer
 * has purchasable tokens and has not allocated yet.
 */
export function shouldOfferTokenAllocator({
  state,
  viewerId,
  seasonId,
  isEpb,
}: {
  state: DraftBoardState;
  viewerId: string;
  seasonId: string | undefined;
  isEpb: boolean;
}): boolean {
  const epb = state.epb;
  return Boolean(
    isEpb &&
      seasonId &&
      state.pool.status === 'complete' &&
      epb &&
      !epb.tokens_allocated_by_player[viewerId] &&
      (epb.purchasable_tokens_by_player[viewerId] ?? 0) > 0,
  );
}

/** Where DraftBoard keeps the last poll's trackers (a React ref). */
export interface TrackersRef {
  current: TrackersByPlayer;
}

/** DraftBoard's state setters, called with each poll's result. */
export interface DraftBoardSink {
  onState(state: DraftBoardState): void;
  /**
   * The poll failed. `error` is the server's English text (or `DRAFT_STATE_LOAD_ERROR`);
   * `detail` carries the server's code/params for translation and is passed only when the
   * server sent a code.
   */
  onError(error: string, detail?: ApiErrorLike): void;
  /** Evo-league poll: the new trackers and the events since the last poll. */
  onEvolution(trackers: TrackersByPlayer, events: EvolutionEvent[]): void;
}

/**
 * The DraftBoard poll tick: one request, then the trackers ref is advanced so
 * the NEXT tick diffs against this poll (the stale-closure fix), and the
 * results go to the sink. Returns the outcome that drives the poller cadence.
 */
export function makeDraftBoardTick({
  fetchImpl,
  poolId,
  withTrackers,
  trackersRef,
  sink,
}: {
  fetchImpl: FetchLike;
  poolId: string;
  withTrackers: boolean;
  trackersRef: TrackersRef;
  sink: DraftBoardSink;
}): (signal: AbortSignal) => Promise<PollOutcome> {
  return async (signal) => {
    const result = await pollDraftBoard({
      fetchImpl,
      poolId,
      withTrackers,
      previousTrackers: trackersRef.current,
      signal,
    });
    if (result.kind === 'aborted' || signal.aborted) return 'stop';

    if (result.kind === 'error') {
      if (result.code) {
        sink.onError(result.error, { error: result.error, code: result.code, params: result.params ?? null });
      } else {
        sink.onError(result.error);
      }
      return result.outcome;
    }

    if (result.evolution) {
      trackersRef.current = result.evolution.trackers;
    }
    sink.onState(result.state);
    if (result.evolution) {
      sink.onEvolution(result.evolution.trackers, result.evolution.events);
    }
    return result.outcome;
  };
}

/**
 * Whose pick the board makes. Snake/linear order: the player whose turn it is (an admin picks on
 * their behalf). Free order: a participant picks for themselves; an admin for the player chosen in
 * "Pick for" (default: the admin themselves when they play, else the suggested next seat). Null when
 * the draft is over.
 */
export function pickerOf(
  state: Pick<DraftBoardState, 'turn_enforced' | 'current_picker' | 'rosters'>,
  viewer: { currentPlayerId: string; isAdmin: boolean; pickFor: string | null },
): string | null {
  if (state.current_picker === null) return null;
  if (state.turn_enforced) return state.current_picker;
  if (viewer.isAdmin) {
    if (viewer.pickFor !== null && viewer.pickFor in state.rosters) return viewer.pickFor;
    return viewer.currentPlayerId in state.rosters ? viewer.currentPlayerId : state.current_picker;
  }
  return viewer.currentPlayerId;
}
