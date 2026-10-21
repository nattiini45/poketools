/**
 * Pure functions for the Evolution Point Buy format.
 * No database access — all logic is deterministic and testable.
 */

import { comebackTokensForLoss } from '@/lib/draft/tokens';
import { epbPack, teraEligibilityForStage, type TeraEligibility } from '@/lib/format-pack';

// ── Draft Tokens ──────────────────────────────────────────────────

/**
 * Compute how many draft tokens a player can purchase with leftover points.
 * @param remainingPoints - Points left after draft (budget - spent)
 * @param ratio - Points per token (default: the format pack's `epb.defaults.tokenRatio`)
 * @param max - Maximum tokens allowed (default: the format pack's `epb.defaults.tokenMax`)
 */
export function computeDraftTokens(
  remainingPoints: number,
  ratio: number = epbPack.defaults.tokenRatio,
  max: number = epbPack.defaults.tokenMax
): number {
  if (remainingPoints < ratio) return 0;
  return Math.min(max, Math.floor(remainingPoints / ratio));
}

/**
 * Compute remaining points after purchasing draft tokens.
 */
export function computeRedraftReserve(
  remainingPoints: number,
  tokensPurchased: number,
  ratio: number = epbPack.defaults.tokenRatio
): number {
  return remainingPoints - tokensPurchased * ratio;
}

export interface TokenAllocation {
  base_pokemon: string;
  /** Draft line id; when set it identifies the line (branched bases), else the base name does. */
  line_id?: string;
  count: number;
}

/**
 * Validate a draft token allocation against the rules.
 * Returns null if valid, or an error message.
 */
export function validateTokenAllocation(
  allocation: TokenAllocation[],
  maxTotal: number,
  maxPerLine: number
): string | null {
  const totalTokens = allocation.reduce((sum, a) => sum + a.count, 0);

  if (totalTokens > maxTotal) {
    return `Cannot allocate more than ${maxTotal} draft tokens total (attempted ${totalTokens})`;
  }

  for (const entry of allocation) {
    if (entry.count > maxPerLine) {
      return `Cannot allocate more than ${maxPerLine} draft token(s) per line (${entry.base_pokemon} has ${entry.count})`;
    }
    if (entry.count < 0) {
      return `Token count cannot be negative (${entry.base_pokemon})`;
    }
  }

  // Check for duplicate lines (line id when given: two branches of one base are two lines)
  const lines = allocation.map((a) => a.line_id ?? a.base_pokemon);
  const uniqueLines = new Set(lines);
  if (lines.length !== uniqueLines.size) {
    return 'Cannot allocate tokens to the same line more than once';
  }

  return null;
}

// ── Kill Tokens ───────────────────────────────────────────────────

/**
 * Comeback Tokens (formerly "kill tokens") earned from one shutout loss. Window-agnostic:
 * which matches earn at all is the pack's `epb.comeback.earnWindow`, applied by
 * `computeEarnedComebackTokens`. Uses the surviving-Pokémon scoreline
 * (loser 0 alive, winner N alive).
 *
 * @param loserSurvivors - Surviving Pokémon for the loser (must be 0 for shutout)
 * @param winnerSurvivors - Surviving Pokémon for the winner
 *
 * Mapping: the format pack's comeback table (`epb.comeback.table`); no shutout = 0.
 * Delegates to the client-safe `comebackTokensForLoss` (one rule, one place).
 */
export function computeKillTokens(loserSurvivors: number, winnerSurvivors: number): number {
  return comebackTokensForLoss(loserSurvivors, winnerSurvivors);
}

// ── Tera Eligibility ──────────────────────────────────────────────

export type { TeraEligibility };

/**
 * Get Tera eligibility based on current evolution stage (format pack `epb.teraByStage`):
 * stage <= 1 -> stage1, 2 -> stage2, higher -> stage3.
 */
export function getTeraEligibility(stage: number): TeraEligibility {
  return teraEligibilityForStage(stage);
}

// ── Evolution Points ──────────────────────────────────────────────

/**
 * Determine if a player earns an evolution point for a matchday.
 * Max 1 per player per matchday, regardless of how many lines evolved. A fixed public
 * mechanic, not a pack field: the SQL twin `epb_recalculate_evolution_points` hard-codes it.
 */
export function earnsEvolutionPoint(evolvedLineCount: number): number {
  return evolvedLineCount > 0 ? 1 : 0;
}

// ── Early Stage-3 Lock ────────────────────────────────────────────

/**
 * Check if a line reaching the lock stage should be suspended (format pack `epb.stageLock`):
 * the lock stage reached by `byMatchday` (inclusive) → suspended for the next
 * `suspendMatchdays` matchdays (`suspensionEndMatchday`). Never when the lock is disabled.
 */
export function shouldSuspend(stageReached: number, matchday: number): boolean {
  const lock = epbPack.stageLock;
  return lock.enabled && stageReached >= lock.stage && matchday <= lock.byMatchday;
}

/** The last matchday a line locked on `matchday` sits out (`suspended_until_matchday`). */
export function suspensionEndMatchday(matchday: number): number {
  return matchday + epbPack.stageLock.suspendMatchdays;
}
