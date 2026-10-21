/**
 * Shared EPB tracker apply helpers.
 * Stage policy stays in epb-stage-resolution; this module only indexes forms,
 * builds transition events, and signs kill deltas for apply/rollback.
 */

import { collectLineForms } from '@/lib/draft/epb-team-validation';
import {
  lineLookup,
  resolveEpbStageTransitions,
  type LineThresholds,
} from '@/lib/match/epb-stage-resolution';
import type { EvolutionEvent, EvolutionTracker } from '@/types/evolution';

export type KillStat = {
  player_id: string;
  pokemon_name: string;
  kos_dealt: number;
};

/**
 * Map `player_id::form` → tracker for every form of each tracked line (lines
 * resolved by `line_id`, legacy base fallback in `lineLookup`).
 * Falls back to base + current form when no line thresholds are present.
 */
export function buildFormToTrackerIndex(
  trackers: EvolutionTracker[],
  lines: LineThresholds[]
): Map<string, EvolutionTracker> {
  const lineOf = lineLookup(lines);
  const formToTracker = new Map<string, EvolutionTracker>();

  for (const tracker of trackers) {
    const line = lineOf(tracker);
    const forms = line
      ? collectLineForms(line, tracker.locked_stage3_pokemon)
      : new Set(
          [
            tracker.base_pokemon,
            tracker.current_form,
            tracker.locked_stage3_pokemon,
          ].filter((form): form is string => Boolean(form))
        );

    for (const form of forms) {
      formToTracker.set(`${tracker.player_id}::${form}`, tracker);
    }
  }

  return formToTracker;
}

/**
 * Resolve stage transitions for a tracker against its line thresholds.
 * Mutates tracker.current_form / current_stage in memory when transitions
 * occur; caller persists via updateTracker + insertEvolutionEvents.
 */
export function applyStageTransitions(
  tracker: EvolutionTracker,
  line: LineThresholds
): EvolutionEvent[] {
  const transitions = resolveEpbStageTransitions(
    line,
    tracker.current_stage,
    tracker.current_form,
    tracker.total_kos,
    tracker.locked_stage3_pokemon
  );

  if (transitions.length === 0) return [];

  const events: EvolutionEvent[] = [];
  let previousForm = tracker.current_form;
  let previousStage = tracker.current_stage;

  for (const transition of transitions) {
    events.push({
      player_id: tracker.player_id,
      base_pokemon: tracker.base_pokemon,
      previous_form: previousForm,
      new_form: transition.form,
      new_stage: transition.stage,
      total_kos: tracker.total_kos,
      is_devolution: transition.stage < previousStage,
      tracker_id: tracker.id,
      previous_stage: previousStage,
    });
    previousForm = transition.form;
    previousStage = transition.stage;
  }

  const finalTransition = transitions[transitions.length - 1];
  tracker.current_form = finalTransition.form;
  tracker.current_stage = finalTransition.stage;

  return events;
}

/**
 * Sign positive KO stats for apply (sign=1) or rollback (sign=-1).
 * Zero / negative input rows are dropped before signing.
 */
export function applyKillDelta(stats: KillStat[], sign: 1 | -1): KillStat[] {
  return stats
    .filter((stat) => stat.kos_dealt > 0)
    .map((stat) => ({
      player_id: stat.player_id,
      pokemon_name: stat.pokemon_name,
      kos_dealt: stat.kos_dealt * sign,
    }));
}
