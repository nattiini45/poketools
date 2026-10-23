/**
 * Pure helpers of `PickSelector`. Client-safe: no React, no `@pkmn/*`.
 */
import type { SearchKeys } from '@/lib/pkmn/i18n/search';
import { speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import type { DraftType } from '@/types/draft';

/**
 * The budget the picker has left once this pick is made (`remainingBudget − cost`).
 * `null` when the draft has no budget; the unchanged budget when the cost is unknown.
 */
export function remainingAfterPick(remainingBudget: number | null, cost: number | null | undefined): number | null {
  if (remainingBudget === null) return null;
  if (cost === null || cost === undefined) return remainingBudget;
  return remainingBudget - cost;
}

/**
 * Search keys of a pool line: the base species plus, for an EPB line, its final
 * stage, each in English, German and transliterated German (`speciesSearchKeys`).
 */
export function lineSearchKeys(base: string, stage3: string | null): SearchKeys {
  const baseKeys = speciesSearchKeys(base);
  if (!stage3) return baseKeys;
  const finalKeys = speciesSearchKeys(stage3);
  return {
    compact: [...new Set([...baseKeys.compact, ...finalKeys.compact])],
    words: [...new Set([...baseKeys.words, ...finalKeys.words])],
  };
}

/**
 * The cost a result row prices with: the matching pool entry's `point_cost`
 * (what the selected-line checks and the server's `legacyPickCost` read), else
 * the row's own cost. Evo-league rows are built from the tier list and carry no
 * cost, so a pool that also has entries must price them from the entry.
 */
export function rowPointCost(
  entryPointCost: number | null | undefined,
  rowCost: number | null | undefined,
): number | undefined {
  return entryPointCost ?? rowCost ?? undefined;
}

/**
 * The listed price of a pick, or null when the pick takes a typed bid. EPB lines
 * cost their `point_cost`. A `budget` pool's price is the entry's `point_cost`,
 * else the pool's `default_point_cost`, else 0: exactly what the server charges
 * (picks route, `legacyPickCost`) and the teambuilder shows. Auction picks are bids.
 */
export function listedPickPrice(
  draftType: DraftType,
  isEpb: boolean,
  pointCost: number | null | undefined,
  defaultPointCost: number | null | undefined = null,
): number | null {
  if (isEpb) return pointCost ?? null;
  if (draftType !== 'budget') return null;
  return pointCost ?? defaultPointCost ?? 0;
}

/**
 * The lowest bid an auction pick accepts: the entry's `point_cost`, at least 1
 * (the server's floor; the pool's `default_point_cost` is no reserve). Null for
 * picks that take no bid (EPB, snake, budget).
 */
export function auctionReserve(
  draftType: DraftType,
  isEpb: boolean,
  pointCost: number | null | undefined,
): number | null {
  if (isEpb || draftType !== 'auction') return null;
  return Math.max(1, pointCost ?? 1);
}

/** True when a typed auction bid is below the reserve (a non-whole bid at or above it is not "below"). */
export function bidBelowReserve(reserve: number | null, typedPoints: number): boolean {
  if (reserve === null) return false;
  return typedPoints < reserve;
}

/**
 * True when a typed auction bid is more than the picker has left (the server
 * refuses it with INSUFFICIENT_BUDGET). Never true without a known budget.
 */
export function bidOverBudget(remainingBudget: number | null, typedPoints: number): boolean {
  return remainingBudget !== null && typedPoints > remainingBudget;
}

/** Why a typed auction bid cannot be armed; each maps to a `picker.*` message. */
export type BidProblem = 'notWhole' | 'belowReserve' | 'overBudget';

/**
 * Every reason a typed auction bid cannot be armed, in announcement order:
 * not a whole number (the server accepts integers only), below the reserve,
 * above the remaining budget. Several can apply at once (40.5 with 40 left is
 * both non-whole and over budget). Empty for a valid bid and for picks that
 * take no bid (`reserve` null).
 */
export function bidProblems(reserve: number | null, remainingBudget: number | null, typedPoints: number): BidProblem[] {
  if (reserve === null) return [];
  const problems: BidProblem[] = [];
  if (!Number.isInteger(typedPoints)) problems.push('notWhole');
  if (bidBelowReserve(reserve, typedPoints)) problems.push('belowReserve');
  if (bidOverBudget(remainingBudget, typedPoints)) problems.push('overBudget');
  return problems;
}

/**
 * True when an auction line's reserve is more than the picker has left: no valid
 * bid exists, so the line is shown over budget like a listed price above it.
 */
export function reserveOverBudget(reserve: number | null, remainingBudget: number | null): boolean {
  return reserve !== null && remainingBudget !== null && reserve > remainingBudget;
}

/**
 * The points field after a row click. Re-clicking the selected line keeps what
 * was typed; a newly selected auction line seeds its reserve, an EPB line its
 * price; anything else keeps the current value.
 */
export function pointsOnRowSelect(opts: {
  alreadySelected: boolean;
  currentPoints: number;
  isEpb: boolean;
  pointCost: number | null | undefined;
  reserve: number | null;
}): number {
  if (opts.alreadySelected) return opts.currentPoints;
  if (opts.reserve !== null) return opts.reserve;
  if (opts.isEpb && opts.pointCost != null) return opts.pointCost;
  return opts.currentPoints;
}

/**
 * The `points_spent` a pick sends: the listed price when there is one, the typed
 * bid for an auction, nothing otherwise.
 */
export function pickPointsToSend(opts: {
  draftType: DraftType;
  isEpb: boolean;
  pointCost: number | null | undefined;
  defaultPointCost?: number | null;
  typedPoints: number;
}): number | undefined {
  const listed = listedPickPrice(opts.draftType, opts.isEpb, opts.pointCost, opts.defaultPointCost);
  if (listed !== null) return listed;
  if (opts.isEpb) return undefined;
  return opts.draftType === 'auction' ? opts.typedPoints : undefined;
}

/**
 * True when the selected pick cannot be made: nothing is selected, its listed
 * price (EPB line or `budget` pool) is above the remaining budget, or the typed
 * auction bid has a `bidProblems` reason (non-whole, below the reserve, above
 * the budget). A reserve above the budget needs no own term: every bid is then
 * non-whole, below the reserve or above the budget. `PickSelector` reads this
 * one decision for the confirm button, the armed dialog and `handleConfirm`.
 */
export function isPickBlocked(opts: {
  hasSelection: boolean;
  /** `listedPickPrice` of the selection: null for an auction (typed bid) or snake pick. */
  listedPrice: number | null;
  /** `auctionReserve` of the selection: null when the pick takes no bid. */
  reserve: number | null;
  remainingBudget: number | null;
  typedPoints: number;
}): boolean {
  if (!opts.hasSelection) return true;
  const { listedPrice, reserve, remainingBudget } = opts;
  if (listedPrice !== null && remainingBudget !== null && listedPrice > remainingBudget) return true;
  return bidProblems(reserve, remainingBudget, opts.typedPoints).length > 0;
}
