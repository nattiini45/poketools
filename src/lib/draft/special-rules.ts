/**
 * Per-line rulings of the Evolution Point Buy format. The mechanics are public; WHICH lines they
 * apply to (and the amounts) come from the active format pack (`@/lib/format-pack`,
 * `epb.lineRules` / `epb.participationPoints`):
 *   - participation line: earns participation ("Cosmo") tokens and is redraft-locked;
 *   - instant-final-stage line: crossing stage 2 also reaches the final stage at once;
 *   - no-cocoon line: catalog filter only (no engine effect).
 * The stored `special_rules` jsonb keys (`cosmog`, `no_redraft`, `scatterbug`, `no_cocoon_rule`)
 * are DB data and keep their names (`STORED_FLAG`).
 */

import { comebackTokensPerProgress, epbLineRuleForBase, epbPack } from '@/lib/format-pack';
import type { SpecialRules } from '@/types/point-buy';

// ── Line Identification ───────────────────────────────────────────

/** A point-buy list row (or anything carrying its base and stored special rules). */
export interface CosmogLineRef {
  base_pokemon: string;
  special_rules?: SpecialRules | null;
}

/**
 * Check if a line is a participation line (pack `lineRules[].participationPoints`).
 * Given a list entry, the stored `special_rules.cosmog` flag decides (BR-2; the importer
 * sets it, the league override layer adds no flag); a base name alone falls back to the
 * pack's line rule for that base (trackers, legacy callers).
 */
export function isCosmogLine(entryOrBase: string | CosmogLineRef): boolean {
  if (typeof entryOrBase === 'string') return !!epbLineRuleForBase(entryOrBase)?.participationPoints;
  if (entryOrBase.special_rules?.cosmog) return true;
  return isCosmogLine(entryOrBase.base_pokemon);
}

/**
 * Check if a base is an instant-final-stage line (pack `lineRules[].instantFinalStage`).
 * The stored `special_rules.scatterbug` flag is deliberately NOT consulted (it never was).
 */
export function isScatterbugLine(basePokemon: string): boolean {
  return !!epbLineRuleForBase(basePokemon)?.instantFinalStage;
}

/** Check if a base is a no-cocoon line (pack `lineRules[].noCocoon`; catalog filter only). */
export function isNoCocoonLine(basePokemon: string): boolean {
  return !!epbLineRuleForBase(basePokemon)?.noCocoon;
}

/**
 * Check if a line is excluded from the redraft: the stored `no_redraft` flag, a participation
 * line when the pack's `participationPoints.locksRedraft` holds, or a pack `redraftLocked` line.
 */
export function isRedraftExcluded(
  basePokemon: string,
  specialRules: SpecialRules | null
): boolean {
  if (specialRules?.no_redraft) return true;
  if (
    epbPack.participationPoints.locksRedraft &&
    isCosmogLine({ base_pokemon: basePokemon, special_rules: specialRules })
  ) {
    return true;
  }
  return !!epbLineRuleForBase(basePokemon)?.redraftLocked;
}

// ── Instant Final Stage ───────────────────────────────────────────

export interface InstantFinalStageResult {
  /** Whether the first evolution (to stage 2) was triggered */
  evolvedToStage2: boolean;
  /** Whether the second evolution (to the final stage) was triggered immediately */
  evolvedToStage3: boolean;
  /** Events to emit (2 for the instant double evolution) */
  events: { new_stage: number; description: string }[];
}

/** The stage names and the stage-2 threshold of an instant-final-stage line. */
export interface InstantFinalStageLine {
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  /** Cumulative KOs to stage 2. */
  stage2_kos: number;
}

/**
 * Handle the instant double evolution of an instant-final-stage line: once stage 2 is reached,
 * the final stage follows at once (0 additional kills).
 */
export function handleInstantFinalStage(
  line: InstantFinalStageLine,
  totalKos: number
): InstantFinalStageResult {
  const events: { new_stage: number; description: string }[] = [];

  if (totalKos < line.stage2_kos) {
    return { evolvedToStage2: false, evolvedToStage3: false, events };
  }

  events.push({ new_stage: 2, description: `${line.base_pokemon} evolved into ${line.stage2_pokemon}` });
  if (line.stage3_pokemon === null) {
    return { evolvedToStage2: true, evolvedToStage3: false, events };
  }

  // The final stage requires 0 additional kills: instant evolution
  events.push({ new_stage: 3, description: `${line.stage2_pokemon} evolved into ${line.stage3_pokemon}` });
  return { evolvedToStage2: true, evolvedToStage3: true, events };
}

// ── Participation Line ────────────────────────────────────────────

// A participation line earns participation tokens, `participationPoints.perMatchday` per
// matchday the line was brought, i.e. in the player's registered team or in the match's battle
// data (progress-engine awardCosmoPoint). Comeback Tokens convert to its progress at the
// pack's `participationPoints.comebackTokensPerProgress`; every other source, and every
// other line, is 1:1.

/**
 * Comeback Tokens one progress point costs on a line: the pack's participation-line rate for a
 * participation line (`isCosmogLine`), else 1. The only TS source of the ratio; the spend RPC
 * receives it per allocation and refuses token counts that are not a multiple of it.
 */
export function comebackTokensPerProgressOf(entryOrBase: string | CosmogLineRef): number {
  return comebackTokensPerProgress(isCosmogLine(entryOrBase));
}

/**
 * Check if a participation line should still receive participation points: only below the
 * pack's `participationPoints.untilStage`.
 */
export function shouldAwardCosmoPoint(currentStage: number): boolean {
  return currentStage < epbPack.participationPoints.untilStage;
}

// ── No-Cocoon Line ────────────────────────────────────────────────

/**
 * A no-cocoon line's middle stage is a full intermediate stage, so the standard evolution logic
 * applies unchanged: the point-buy list values pass through as they are.
 */
export function applyNoCocoonRule(killsToStage2: number, additionalKillsToStage3: number | null): {
  killsToStage2: number;
  additionalKillsToStage3: number | null;
} {
  return { killsToStage2, additionalKillsToStage3 };
}

// ── Cumulative Threshold Computation ──────────────────────────────

/**
 * Convert separate stage2/additional stage3 kill requirements into
 * the cumulative threshold format used by the existing evolution engine.
 *
 * The engine's resolveStage() checks `totalKos >= stage3_kos`, so we store
 * stage3_kos = kills_to_stage2 + additional_kills_to_stage3.
 *
 * Example: 4 kills to stage2, 10 additional to stage3 → stage3_kos = 14
 */
export function toCumulativeThresholds(
  killsToStage2: number,
  additionalKillsToStage3: number | null
): { stage2_kos: number; stage3_kos: number | null } {
  return {
    stage2_kos: killsToStage2,
    stage3_kos: additionalKillsToStage3 !== null
      ? killsToStage2 + additionalKillsToStage3
      : null,
  };
}

// ── Next-Stage Resolution ────────────────────────────────────

export interface NextStageTarget {
  /** Form the line evolves into next */
  nextForm: string;
  /** Cumulative KO threshold (same scale as tracker.total_kos) */
  requirement: number;
}

/**
 * Resolve the next evolution target for a line at a given stage.
 *
 * Returns null when the line is fully evolved: at stage 3, or at stage 2
 * of a two-stage line. This is the single source of truth for "what comes
 * next" on the match detail page and in the Crystal XP replay — never fall
 * back to a lower stage's threshold.
 */
export function resolveNextStageTarget(
  entry: {
    stage2_pokemon: string;
    stage3_pokemon: string | null;
    kills_to_stage2: number;
    additional_kills_to_stage3: number | null;
  },
  currentStage: number,
): NextStageTarget | null {
  const cumulative = toCumulativeThresholds(
    entry.kills_to_stage2,
    entry.additional_kills_to_stage3,
  );

  if (currentStage <= 1) {
    return { nextForm: entry.stage2_pokemon, requirement: cumulative.stage2_kos };
  }
  if (currentStage === 2 && entry.stage3_pokemon && cumulative.stage3_kos !== null) {
    return { nextForm: entry.stage3_pokemon, requirement: cumulative.stage3_kos };
  }
  // Stage 3, or stage 2 of a two-stage line — fully evolved
  return null;
}
