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
 * Comeback Tokens (formerly "kill tokens") earned from a shutout loss, in any
 * matchday of the season (no Hinrunde cap). Uses the surviving-Pokémon
 * scoreline (loser 0 alive, winner N alive).
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

// ── Missing-Kills Transfer (trades) ──────────────────────────────
// Used by consented trades only (prepareRedraftSwap). A published redraft
// transfers frozen real kills per slot instead (redraft_slots, SQL).

export interface MissingKillsTransferResult {
  /** Stage the new line starts at */
  stage: number;
  /** Progress (kills toward next stage) the new line starts with */
  progress: number;
}

/**
 * Compute the progress transfer when redrafting from one line to another.
 *
 * Rule: Transfer "missing kills" (kills still needed to next evolution).
 * - If old line was fully evolved (stage 3), new line is also fully evolved.
 * - If old line's missing kills > new line's full stage requirement, new line starts at same stage with 0 progress.
 * - Otherwise, new line starts at same stage with (requirement - missing) progress.
 *
 * @param currentStage - Stage of the old line (1, 2, or 3)
 * @param currentProgress - Kills accumulated toward next stage on old line
 * @param currentRequirement - Kills needed for next stage on old line
 * @param newLineKillsToStage2 - Kills needed for stage 2 on new line
 * @param newLineKillsToStage3 - Additional kills needed for stage 3 on new line (after stage 2)
 */
export function computeMissingKillsTransfer(
  currentStage: number,
  currentProgress: number,
  currentRequirement: number,
  newLineKillsToStage2: number,
  newLineKillsToStage3: number | null
): MissingKillsTransferResult {
  // Fully evolved line stays fully evolved
  if (currentStage >= 3) {
    return { stage: 3, progress: 0 };
  }

  const missingKills = currentRequirement - currentProgress;

  if (currentStage === 1) {
    // Transferring from stage 1: apply missing kills to new line's stage 2 requirement
    if (missingKills >= newLineKillsToStage2) {
      // Missing more than the new line needs — start at stage 1 with 0
      return { stage: 1, progress: 0 };
    }
    // New progress = requirement - missing
    return { stage: 1, progress: newLineKillsToStage2 - missingKills };
  }

  // currentStage === 2: apply to new line's stage 3 requirement
  if (newLineKillsToStage3 === null) {
    // New line has no stage 3 — it stays at stage 2
    return { stage: 2, progress: 0 };
  }
  if (newLineKillsToStage3 === 0) {
    // 0 additional kills means instant stage 3 (an instant-final-stage line)
    return { stage: 3, progress: 0 };
  }

  const newRequirement = newLineKillsToStage3;
  if (missingKills >= newRequirement) {
    return { stage: 2, progress: 0 };
  }
  return { stage: 2, progress: newRequirement - missingKills };
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
