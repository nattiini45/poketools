import type {
  DraftPool,
  DraftPickOrder,
  DraftPickWithPlayer,
  DraftState,
  DraftType,
  MakePickInput,
} from '@/types/draft';
import { minCompletion } from './budget';
import { isTurnEnforced } from './pool-format';

// ─── Snake Draft Order ──────────────────────────────────────────────

/**
 * Generate the full pick order for a snake draft.
 *
 * Round 1: [A, B, C, D]
 * Round 2: [D, C, B, A]  (reversed)
 * Round 3: [A, B, C, D]  (back to normal)
 * ...
 *
 * Returns a flat array of player_ids in pick order.
 */
export function generateSnakeOrder(
  playerIds: string[],
  totalRounds: number
): string[] {
  const order: string[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const roundOrder = round % 2 === 1
      ? [...playerIds]
      : [...playerIds].reverse();
    order.push(...roundOrder);
  }
  return order;
}

/**
 * Seat order of one round (1-based): snake reverses every even round; linear and
 * free keep the seat order (free only displays it, see `computeDraftState`).
 */
export function getRoundOrder(playerIds: string[], round: number, pickOrder: DraftPickOrder): string[] {
  return pickOrder === 'snake' && round % 2 === 0 ? [...playerIds].reverse() : [...playerIds];
}

/**
 * Determine which round a given pick number falls in.
 */
export function getRoundForPick(pickNumber: number, playerCount: number): number {
  return Math.ceil(pickNumber / playerCount);
}

// ─── Seat Order ─────────────────────────────────────────────────────

/** FNV-1a (32 bit): a small, stable string hash. Not for security; only a seeded draw. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Seat order of a legacy pool: a draw seeded by the pool id, so it is the same on every request and every server
 * (the participant read has no order, and `season_participants` stores neither seats nor a join time). Each pool
 * draws again, so no player sits first in every league. Ties fall back to the player id. A participant who joins
 * or leaves mid-draft still moves the seats after theirs.
 */
export function legacySeatOrder(poolId: string, playerIds: readonly string[]): string[] {
  return playerIds
    .map((id) => ({ id, key: fnv1a(`${poolId}:${id}`) }))
    .sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((seat) => seat.id);
}

// ─── Draft State Computation ────────────────────────────────────────

/**
 * Build the full draft state from a pool, its picks, and the participant list in seat order
 * (routes pass `legacySeatOrder(pool.id, ids)`).
 * This is the single source of truth for the draft room UI.
 */
export function computeDraftState(
  pool: DraftPool,
  picks: DraftPickWithPlayer[],
  participantIds: string[],
  totalRounds: number
): DraftState {
  // Build rosters: player_id → pokemon names
  const rosters: Record<string, string[]> = {};
  for (const pid of participantIds) {
    rosters[pid] = [];
  }
  for (const pick of picks) {
    if (!rosters[pick.player_id]) rosters[pick.player_id] = [];
    rosters[pick.player_id].push(pick.pokemon_name);
  }

  // Build taken set
  const taken_pokemon = new Set(picks.map((p) => p.pokemon_name));

  // Compute budgets when a point budget is configured (auction/budget/EPB)
  let budgets: Record<string, number> | null = null;
  if (pool.point_budget !== null) {
    budgets = {};
    for (const pid of participantIds) {
      budgets[pid] = pool.point_budget;
    }
    for (const pick of picks) {
      if (pick.points_spent !== null && budgets[pick.player_id] !== undefined) {
        budgets[pick.player_id] -= pick.points_spent;
      }
    }
  }

  const totalPicks = participantIds.length * totalRounds;
  const nextPickNumber = picks.length + 1;
  const currentRound = picks.length > 0
    ? getRoundForPick(nextPickNumber, participantIds.length)
    : 1;

  // Turn order comes from `pick_order` (pricing is `draft_type`). Free order keeps a display order
  // (round-robin over the seats) but enforces no turn: `current_picker` is only a suggestion then.
  const pick_order = getRoundOrder(participantIds, currentRound, pool.pick_order);
  let current_picker: string | null = null;
  if (nextPickNumber <= totalPicks && participantIds.length > 0) {
    const indexInRound = (nextPickNumber - 1) % participantIds.length;
    current_picker = pick_order[indexInRound];
  }

  return {
    pool,
    picks,
    rosters,
    budgets,
    pick_order,
    current_picker,
    turn_enforced: isTurnEnforced(pool.pick_order),
    next_pick_number: nextPickNumber,
    current_round: currentRound,
    taken_pokemon,
  };
}

// ─── Pick Validation ────────────────────────────────────────────────

export interface PickValidationError {
  code:
    | 'POOL_NOT_ACTIVE'
    | 'NOT_YOUR_TURN'
    | 'POKEMON_TAKEN'
    | 'INSUFFICIENT_BUDGET'
    | 'DRAFT_COMPLETE'
    | 'LINE_TAKEN';
  message: string;
}

export interface ValidatePickOptions {
  /**
   * Skip the "this Pokémon name is already drafted" check. Evolution Point
   * Buy picks store the line's base Pokémon as `pokemon_name`, so both
   * branches of a branched base (Oshawott → Samurott / Samurott-Hisui) share
   * a name; their availability is the line check (base + stage-3 branch)
   * in the picks route instead.
   */
  skipNameTakenCheck?: boolean;
}

/**
 * Validate that a pick can be made. Returns null if valid, or an error.
 */
export function validatePick(
  state: DraftState,
  input: MakePickInput,
  /** True when turns are enforced (`pick_order` snake or linear); free order lets anyone pick. */
  enforceOrder: boolean,
  opts?: ValidatePickOptions
): PickValidationError | null {
  if (state.pool.status !== 'in_progress') {
    return { code: 'POOL_NOT_ACTIVE', message: 'Draft is not currently active' };
  }

  if (state.current_picker === null) {
    return { code: 'DRAFT_COMPLETE', message: 'All picks have been made' };
  }

  if (enforceOrder && input.player_id !== state.current_picker) {
    // No player id in the message: it reaches the client verbatim. Same text as the catalog (`errors/draft`).
    return { code: 'NOT_YOUR_TURN', message: 'It is not your turn.' };
  }

  if (!opts?.skipNameTakenCheck && state.taken_pokemon.has(input.pokemon_name)) {
    return {
      code: 'POKEMON_TAKEN',
      message: `${input.pokemon_name} has already been drafted`,
    };
  }

  // Budget check for auction/budget drafts
  if (state.budgets !== null && input.points_spent !== undefined && input.points_spent !== null) {
    const remaining = state.budgets[input.player_id] ?? 0;
    if (input.points_spent > remaining) {
      return {
        code: 'INSUFFICIENT_BUDGET',
        message: `Not enough points. Has ${remaining}, needs ${input.points_spent}`,
      };
    }
  }

  return null;
}

// ─── Roster completion (fixed costs with turn order) ────────────────

export interface RosterCompletionInput {
  /** The picker's points before this pick. */
  remaining: number;
  /** This pick's price. */
  price: number;
  /** Picks the picker still has to make after this one. */
  slotsAfter: number;
  /**
   * Ascending prices of every other Pokémon still available, without the candidate itself.
   * `null` = the season has no pool list (any Pokémon may be picked), so every remaining slot
   * can be filled at `fallbackPrice`.
   */
  otherPricesSorted: readonly number[] | null;
  /** The pool's `default_point_cost` (or 0): the price of a Pokémon without its own cost. */
  fallbackPrice: number;
}

export interface RosterCompletionShortfall {
  slots: number;
  min_cost: number;
  remaining_after: number;
}

/**
 * Snake/linear order with fixed costs: a pick must leave the picker enough points to fill their
 * remaining rounds at the cheapest prices still available, or the draft would stall on their turn
 * (nobody else may pick for them). Mirrors `evaluateCompletion` / `minCompletion` in `./budget`
 * on price alone: tier limits are not folded in. Returns the shortfall, or null when the pick is fine.
 *
 * Best effort: it guards against the picker's own pick only. Other players can still take the cheap
 * Pokémon before the picker's next turn and leave them short; `legacyPickerStall` reports that on the board,
 * and an admin switches the pool to free order (`POST /api/drafts/[id]/free-order`) or undoes picks.
 *
 * Fewer Pokémon left than open slots is not refused here: any other pick would leave as few, so only
 * the cheapest ones that still exist are counted.
 */
export function rosterCompletionShortfall(i: RosterCompletionInput): RosterCompletionShortfall | null {
  const slots = Math.max(0, Math.floor(i.slotsAfter));
  if (slots === 0) return null;
  const remainingAfter = i.remaining - i.price;
  const minCost = i.otherPricesSorted === null
    ? slots * i.fallbackPrice
    : minCompletion(i.otherPricesSorted, slots).cost;
  return minCost > remainingAfter ? { slots, min_cost: minCost, remaining_after: remainingAfter } : null;
}

/**
 * Ascending prices of every Pokémon still available in a legacy fixed-price pool (names compared case-insensitively,
 * as the picks route does), leaving out `exclude` (the candidate of a pick). `null` = the season has no pool list:
 * any Pokémon may be picked at `fallbackPrice`.
 */
export function availablePricesSorted(
  entries: readonly { pokemon_name: string; point_cost: number | null }[],
  takenNames: Iterable<string>,
  fallbackPrice: number,
  exclude?: { pokemon_name: string; point_cost: number | null },
): number[] | null {
  if (entries.length === 0) return null;
  const taken = new Set(Array.from(takenNames, (name) => name.toLowerCase()));
  return entries
    .filter((e) => e !== exclude && !taken.has(e.pokemon_name.toLowerCase()))
    .map((e) => e.point_cost ?? fallbackPrice)
    .sort((a, b) => a - b);
}

export interface PickerStall {
  player_id: string;
  /** The picker's points. */
  remaining: number;
  /** Picks the picker still has to make, this one included. */
  open_slots: number;
  /** What the cheapest Pokémon still available for those picks cost together. */
  min_cost: number;
}

/**
 * Snake/linear order with fixed costs: is the current picker stuck? They are when even the cheapest Pokémon still
 * available cannot fill their open picks, so every pick is refused (`INSUFFICIENT_BUDGET` or
 * `draft_pick_strands_roster`) and, with nobody else allowed to pick, the draft cannot go on. Taking the cheapest
 * Pokémon is the best move (any other pick plus the cheapest completion costs at least as much), so the check is
 * the cheapest `open_slots` prices against the budget. Same rule as the picks route: price only, tier limits not
 * folded in, and with fewer Pokémon left than open picks only the ones that still exist count. No Pokémon left at
 * all is not a budget stall (null).
 */
export function legacyPickerStall(i: {
  state: Pick<DraftState, 'pool' | 'current_picker' | 'turn_enforced' | 'budgets' | 'rosters'>;
  totalRounds: number;
  /** From `availablePricesSorted` without an exclusion. */
  availablePrices: readonly number[] | null;
  fallbackPrice: number;
}): PickerStall | null {
  const { state } = i;
  const picker = state.current_picker;
  if (
    picker === null ||
    !state.turn_enforced ||
    state.pool.status !== 'in_progress' ||
    state.pool.draft_type !== 'budget' ||
    state.budgets === null
  ) {
    return null;
  }
  const remaining = state.budgets[picker] ?? 0;
  const openSlots = Math.max(0, i.totalRounds - (state.rosters[picker]?.length ?? 0));
  if (openSlots === 0) return null;
  let minCost: number;
  if (i.availablePrices === null) {
    minCost = openSlots * i.fallbackPrice;
  } else {
    const { count, cost } = minCompletion(i.availablePrices, openSlots);
    if (count === 0) return null;
    minCost = cost;
  }
  return minCost > remaining ? { player_id: picker, remaining, open_slots: openSlots, min_cost: minCost } : null;
}

// ─── Draft Completion ───────────────────────────────────────────────

/**
 * Check if a draft is complete (all picks made).
 */
export function isDraftComplete(
  pickCount: number,
  participantCount: number,
  totalRounds: number
): boolean {
  return pickCount >= participantCount * totalRounds;
}

/**
 * Determine total rounds based on draft type.
 * Snake drafts typically have a fixed number of rounds (e.g., 10-12 for a standard team).
 * EPB seasons override with format_rules.draft_picks (default 9).
 * This can be overridden by the admin at pool creation.
 */
export function getDefaultRounds(draftType: DraftType): number {
  switch (draftType) {
    case 'snake':
      return 11; // Standard draft league roster size
    case 'auction':
    case 'budget':
      return 11;
    default:
      return 11;
  }
}

/** Resolve total draft rounds, preferring explicit EPB/format overrides. */
export function resolveTotalRounds(
  pool: DraftPool,
  options?: { epbDraftPicks?: number | null }
): number {
  if (options?.epbDraftPicks != null && options.epbDraftPicks > 0) {
    return options.epbDraftPicks;
  }
  if (pool.team_size_mode === 'exact' && pool.team_size_exact != null && pool.team_size_exact > 0) {
    return pool.team_size_exact;
  }
  return getDefaultRounds(pool.draft_type);
}
