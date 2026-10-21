/**
 * Draft budget rules (draft-backend §7.3; SPEC Prompt 3 §3, Prompt 6 §7–8).
 * Client-safe and pure: no `@pkmn/*`, no Supabase, no `next/*`.
 *
 * Picker level: a pick is legal only if, after it, the player can still fill every
 * remaining roster slot with the cheapest currently legal lines. The SQL
 * twin is `draft__commit_pick` step 5 with `draft__min_completion`
 * (M5; ordered by price, then line id; the sum does not depend on ties).
 * Pool level (every participant at once, the gate that keeps a draft always
 * completable): `completability.ts`. A pick must pass both.
 * `seasonRemainingPoints` mirrors `epb__season_remaining_points`.
 */

/** The cheapest `slots` prices of an ascending list: how many exist (≤ slots) and what they cost together. */
export function minCompletion(sortedPrices: readonly number[], slots: number): { count: number; cost: number } {
  const count = Math.max(0, Math.min(Math.floor(slots), sortedPrices.length));
  let cost = 0;
  for (let i = 0; i < count; i++) cost += sortedPrices[i];
  return { count, cost };
}

export type CompletionResult =
  | { ok: true; remainingAfter: number }
  | { ok: false; code: 'INSUFFICIENT_BUDGET'; params: { price: number; remaining: number } }
  | { ok: false; code: 'NOT_ENOUGH_LINES'; params: { slots: number; available: number } }
  | {
      ok: false;
      code: 'BUDGET_INFEASIBLE';
      params: { shortfall: number; slots: number; remaining_after: number; min_cost: number };
    };

/**
 * Can the player take a line costing `price` now and still complete the roster?
 *
 * - `remaining`: budget left before this pick.
 * - `openSlots`: roster slots still open **including** the one this pick fills
 *   (`ROSTER_FULL` for `openSlots < 1` is the caller's viewer-level check; here it counts as 0 slots after).
 * - `otherLegalPricesSorted`: ascending prices of every other line the player could legally take
 *   (not taken, not restricted for them, not redraft-locked), **without** the candidate itself.
 *
 * Order (= SQL): `INSUFFICIENT_BUDGET` → `NOT_ENOUGH_LINES` → `BUDGET_INFEASIBLE`.
 */
export function evaluateCompletion(i: {
  remaining: number;
  openSlots: number;
  price: number;
  otherLegalPricesSorted: readonly number[];
}): CompletionResult {
  const { remaining, price } = i;
  if (price > remaining) {
    return { ok: false, code: 'INSUFFICIENT_BUDGET', params: { price, remaining } };
  }
  const slotsAfter = Math.max(0, i.openSlots - 1);
  const remainingAfter = remaining - price;
  const { count, cost } = minCompletion(i.otherLegalPricesSorted, slotsAfter);
  if (count < slotsAfter) {
    return { ok: false, code: 'NOT_ENOUGH_LINES', params: { slots: slotsAfter, available: count } };
  }
  if (cost > remainingAfter) {
    return {
      ok: false,
      code: 'BUDGET_INFEASIBLE',
      params: { shortfall: cost - remainingAfter, slots: slotsAfter, remaining_after: remainingAfter, min_cost: cost },
    };
  }
  return { ok: true, remainingAfter };
}

/**
 * True when at least one legal line is a feasible pick at picker level for a player with `openSlots` open slots
 * (≥ 1) and `remaining` budget: if the cheapest `openSlots` lines fit the budget, taking the cheapest line is
 * feasible, and every feasible pick plus the cheapest completion costs at least that much. `openSlots < 1` → false.
 * Twin of the invariant check in `draft__activate_next` (COMPLETABILITY_INVARIANT): with the pool gate a player on
 * the clock always has a legal pick, so this only ever fails on a broken invariant. A precheck only; the pool gate
 * (`completability.ts`) decides.
 */
export function hasLegalPick(legalPricesSorted: readonly number[], openSlots: number, remaining: number): boolean {
  if (openSlots < 1) return false;
  const { count, cost } = minCompletion(legalPricesSorted, openSlots);
  return count >= openSlots && cost <= remaining;
}

/** Everything the season points ledger reads, for one season (all pools of the season). */
export interface SeasonPointLedger {
  /** The initial pool's `point_budget`, else `format_rules.draft_budget`. */
  initialBudget: number;
  /**
   * League groups only: each trainer's group's initial pool budget (else `format_rules.draft_budget`); a trainer
   * missing here falls back to `initialBudget`. Absent in a league without groups.
   */
  initialBudgetByPlayer?: Readonly<Record<string, number>>;
  /** `format_rules.draft_token_ratio` (points per legacy one-shot draft token). */
  tokenRatio: number;
  /** Draft picks of every pool of the season. `points_spent` null counts as 0. */
  picks: readonly { player_id: string; points_spent: number | null; voided: boolean; pool_cancelled: boolean }[];
  /** Legacy one-shot `epb_token_grants` rows with `grant_type = 'draft_token'`. */
  legacyDraftTokenGrants: readonly { player_id: string; token_count: number }[];
  /** `epb_draft_token_purchases` rows (points are permanently spent). */
  draftTokenPurchases: readonly { player_id: string; points_spent: number }[];
  /** Legacy `redraft_history` spends. */
  legacyRedraftSpend: readonly { player_id: string; points_spent: number }[];
  /** `redraft_slots` rows: the dropped line's price is refunded into the budget. */
  redraftRefunds: readonly { player_id: string; dropped_price: number }[];
}

function sumFor<T extends { player_id: string }>(rows: readonly T[], playerId: string, value: (row: T) => number): number {
  let total = 0;
  for (const row of rows) if (row.player_id === playerId) total += value(row);
  return total;
}

/**
 * Unspent season points of one player; twin of `epb__season_remaining_points` (M5; the base is the
 * trainer's group's initial pool in a league with groups, 20261018180000):
 * initial budget − non-void picks of non-cancelled pools − legacy grant tokens × ratio
 * − Draft Kill Token purchases − legacy redraft spends + redraft refunds (dropped prices).
 * Draft Kill Token points never come back (SPEC Prompt 6 §7).
 */
export function seasonRemainingPoints(l: SeasonPointLedger, playerId: string): number {
  const picked = sumFor(l.picks, playerId, (p) => (p.voided || p.pool_cancelled ? 0 : (p.points_spent ?? 0)));
  const legacyTokens = sumFor(l.legacyDraftTokenGrants, playerId, (g) => g.token_count) * l.tokenRatio;
  const purchases = sumFor(l.draftTokenPurchases, playerId, (x) => x.points_spent);
  const redraftSpend = sumFor(l.legacyRedraftSpend, playerId, (r) => r.points_spent);
  const refunds = sumFor(l.redraftRefunds, playerId, (r) => r.dropped_price);
  const base = l.initialBudgetByPlayer?.[playerId] ?? l.initialBudget;
  return base - picked - legacyTokens - purchases - redraftSpend + refunds;
}
