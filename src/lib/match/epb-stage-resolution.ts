/**
 * Pure EPB stage-transition resolution.
 * Emits one transition per stage crossed (an instant-final-stage line crosses two at once).
 */

import {
  handleInstantFinalStage,
  isScatterbugLine,
} from '@/lib/draft/special-rules';
import { toLineId } from '@/lib/draft/line-identity';

export interface LineThresholds {
  /**
   * Stable draft line id (`point_buy_list_entries.line_id`); null/absent for
   * legacy evolution-tier leagues. Branched bases (Oshawott → Samurott / Samurott-Hisui) have one
   * line each, so every line lookup goes through `lineLookup`, never a base-keyed map.
   */
  line_id?: string | null;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  /** Cumulative KOs required for stage 2 */
  stage2_kos: number;
  /** Cumulative KOs required for stage 3 (stage2 + additional), null if no stage 3 */
  stage3_kos: number | null;
}

/** The tracker columns a line lookup reads. */
export interface LineLookupKey {
  line_id?: string | null;
  base_pokemon: string;
  locked_stage3_pokemon?: string | null;
}

/**
 * Build a tracker → line resolver over a season's lines.
 *
 * Keyed by `line_id` (`tracker.line_id` → line; a line without an id is keyed by its derived
 * `toLineId(base, final stage)`); a tracker whose `line_id` matches no line resolves to
 * `undefined` (no base guess). Legacy fallback only when the tracker has no
 * line id (evolution-tier leagues, trackers written before M1): the line with the same
 * base whose stage 3 equals the tracker's locked stage 3, else the first line of that base.
 */
export function lineLookup<L extends LineThresholds>(
  lines: readonly L[]
): (tracker: LineLookupKey) => L | undefined {
  const byId = new Map<string, L>();
  const byBase = new Map<string, L[]>();
  for (const line of lines) {
    // Lines loaded without ids (evolution-tier fallback) are keyed by their derived id, so a
    // tracker carrying a line id still resolves branch-exactly.
    const id = line.line_id || toLineId(line.base_pokemon, line.stage3_pokemon ?? line.stage2_pokemon);
    if (!byId.has(id)) byId.set(id, line);
    const list = byBase.get(line.base_pokemon);
    if (list) list.push(line);
    else byBase.set(line.base_pokemon, [line]);
  }

  return (tracker) => {
    // A tracker with a line id resolves by id only: a base fallback could pick the wrong branch
    // (Oshawott → Samurott vs Samurott-Hisui), so an unknown id is "no line", not a guess.
    if (tracker.line_id) return byId.get(tracker.line_id);
    const candidates = byBase.get(tracker.base_pokemon);
    if (!candidates) return undefined;
    if (tracker.locked_stage3_pokemon) {
      const branch = candidates.find((line) => line.stage3_pokemon === tracker.locked_stage3_pokemon);
      if (branch) return branch;
    }
    return candidates[0];
  };
}

export interface StageTransition {
  form: string;
  stage: number;
}

/**
 * KOs at which a line reaches stage 3. An instant-final-stage line (format pack
 * `lineRules[].instantFinalStage`) gets there as soon as `stage2_kos` is crossed, whatever its stored
 * `stage3_kos` says (effective additional kills = 0).
 */
function effectiveStage3Kos(line: LineThresholds): number | null {
  return isScatterbugLine(line.base_pokemon) ? line.stage2_kos : line.stage3_kos;
}

/**
 * Resolve the final stage + form for a cumulative KO total against line thresholds.
 * An instant-final-stage line (format pack `lineRules[].instantFinalStage`) reaches its final stage
 * as soon as `stage2_kos` is crossed, whatever its stored `stage3_kos` says (effective additional
 * kills = 0), so a recheck agrees with the jump of `resolveEpbStageTransitions` and never devolves it.
 */
export function resolveEpbStage(
  line: LineThresholds,
  totalKos: number,
  lockedStage3?: string | null
): { form: string; stage: number } {
  if (line.stage3_pokemon) {
    const stage3Kos = effectiveStage3Kos(line);
    if (stage3Kos !== null && totalKos >= stage3Kos) {
      return { form: lockedStage3 ?? line.stage3_pokemon, stage: 3 };
    }
  }
  if (totalKos >= line.stage2_kos) {
    return { form: line.stage2_pokemon, stage: 2 };
  }
  return { form: line.base_pokemon, stage: 1 };
}

/**
 * Resolve forward stage transitions crossed since `previousStage`.
 * An instant-final-stage line (format pack `lineRules[].instantFinalStage`) uses
 * handleInstantFinalStage for its double evolution.
 * Devolution returns a single target transition.
 */
export function resolveEpbStageTransitions(
  line: LineThresholds,
  previousStage: number,
  previousForm: string,
  totalKos: number,
  lockedStage3?: string | null
): StageTransition[] {
  const target = resolveEpbStage(line, totalKos, lockedStage3);
  if (target.stage === previousStage && target.form === previousForm) {
    return [];
  }

  if (target.stage < previousStage) {
    return [{ form: target.form, stage: target.stage }];
  }

  if (isScatterbugLine(line.base_pokemon) && previousStage <= 1 && totalKos >= line.stage2_kos) {
    const instant = handleInstantFinalStage(line, totalKos);
    const transitions: StageTransition[] = [];
    for (const event of instant.events) {
      if (event.new_stage === 2) {
        transitions.push({ form: line.stage2_pokemon, stage: 2 });
      } else if (event.new_stage === 3 && line.stage3_pokemon) {
        transitions.push({ form: line.stage3_pokemon, stage: 3 });
      }
    }
    return transitions;
  }

  const transitions: StageTransition[] = [];
  let stage = previousStage;

  if (stage < 2 && totalKos >= line.stage2_kos) {
    transitions.push({ form: line.stage2_pokemon, stage: 2 });
    stage = 2;
  }

  // Same threshold as resolveEpbStage, so an instant-final-stage line already at stage 2 (e.g. after a
  // redraft transfer) also advances instead of staying at stage 2.
  const stage3Kos = effectiveStage3Kos(line);
  if (stage < 3 && line.stage3_pokemon && stage3Kos !== null && totalKos >= stage3Kos) {
    transitions.push({ form: lockedStage3 ?? line.stage3_pokemon, stage: 3 });
  }

  return transitions;
}
