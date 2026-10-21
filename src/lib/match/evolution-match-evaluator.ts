/**
 * Evolution Point Buy match evaluator.
 * Orchestrates post-match evolution logic for the evolution_point_buy format.
 * Called from game-pipeline after battle_stats are written.
 *
 * For evolution_point_buy seasons this module OWNS tracker progress and stage
 * resolution. The legacy checkPlayerEvolutions engine must NOT run for this
 * format — it re-derives total_kos from battle_stats alone and would erase
 * token/cosmo contributions.
 */

import {
  getSeasonTrackers,
  updateTracker,
  applyTrackerProgressWithLog,
} from '@/lib/supabase/queries/evolutions';
import { insertEvolutionEvents } from '@/lib/supabase/queries/evolution-events';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { lineLookup, type LineThresholds } from '@/lib/match/epb-stage-resolution';
import {
  applyKillDelta,
  applyStageTransitions,
  buildFormToTrackerIndex,
} from '@/lib/match/epb-tracker-apply';
import type { EvolutionEvent } from '@/types/evolution';

export type { LineThresholds };

/**
 * Apply real kills from a game's battle_stats to evolution trackers.
 *
 * Matches battle_stats.pokemon_name against ALL forms in each line
 * (base, stage2, stage3) — a Pokemon that already evolved records KOs
 * under its evolved form name.
 *
 * Updates real_kills + total_kos, then resolves stage transitions from
 * the line thresholds and emits EvolutionEvents for any form changes.
 * Events are persisted to evolution_events (development-event log).
 */
export async function applyRealKillsFromGame(
  seasonId: string,
  battleStats: { player_id: string; pokemon_name: string; kos_dealt: number }[],
  opts: { matchday?: number | null } = {}
): Promise<EvolutionEvent[]> {
  const [trackers, lines] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
  ]);
  if (trackers.length === 0) return [];

  const lineOf = lineLookup(lines);

  const formToTracker = buildFormToTrackerIndex(trackers, lines);
  const events: EvolutionEvent[] = [];
  const touched = new Set<string>();

  for (const stat of applyKillDelta(battleStats, 1)) {
    const tracker = formToTracker.get(`${stat.player_id}::${stat.pokemon_name}`);
    if (!tracker) continue;

    // Atomic SQL increment + audit log in one transaction; the RPC returns
    // the post-update tracker state.
    const updated = await applyTrackerProgressWithLog(tracker.id, 'real_kill', stat.kos_dealt, {
      matchday: opts.matchday ?? null,
      note: 'KO from battle',
    });

    // Update in-memory for subsequent stats in same game
    tracker.real_kills = updated.real_kills;
    tracker.total_kos = updated.total_kos;
    touched.add(tracker.id);
  }

  // Resolve stage transitions for touched trackers
  for (const tracker of trackers) {
    if (!touched.has(tracker.id)) continue;
    const line = lineOf(tracker);
    if (!line) continue;

    const transitions = applyStageTransitions(tracker, line);
    if (transitions.length === 0) continue;

    events.push(...transitions);

    await updateTracker(tracker.id, {
      current_form: tracker.current_form,
      current_stage: tracker.current_stage,
      evolved_at: new Date().toISOString(),
    });
  }

  // Persist the development events (W7 audit trail). Failures must not
  // undo the already-applied progress — log and continue.
  try {
    await insertEvolutionEvents(events, { season_id: seasonId, matchday: opts.matchday ?? null });
  } catch (err) {
    console.error('Failed to persist evolution events (progress already applied)', err);
  }

  return events;
}

/**
 * Re-resolve EPB tracker stages from current total_kos (used after undo/
 * rollback and admin corrections). Does NOT touch total_kos or source
 * columns — only form/stage. Transitions are persisted as development
 * events (is_manual for admin corrections).
 */
export async function recheckEpbStages(
  seasonId: string,
  playerIds: string[],
  opts: { matchday?: number | null; isManual?: boolean } = {}
): Promise<EvolutionEvent[]> {
  const [allTrackers, lines] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
  ]);

  const lineOf = lineLookup(lines);

  const trackers = allTrackers.filter((t) => playerIds.includes(t.player_id));
  const events: EvolutionEvent[] = [];

  for (const tracker of trackers) {
    const line = lineOf(tracker);
    if (!line) continue;

    const transitions = applyStageTransitions(tracker, line);
    if (transitions.length === 0) continue;

    events.push(...transitions);

    await updateTracker(tracker.id, {
      current_form: tracker.current_form,
      current_stage: tracker.current_stage,
      evolved_at: new Date().toISOString(),
    });
  }

  try {
    await insertEvolutionEvents(events, {
      season_id: seasonId,
      matchday: opts.matchday ?? null,
      is_manual: opts.isManual ?? false,
    });
  } catch (err) {
    console.error('Failed to persist evolution events (stage recheck already applied)', err);
  }

  return events;
}

/**
 * Subtract real kills for a deleted game's battle_stats (undo path).
 * Mirrors applyRealKillsFromGame with negative amounts, clamped at 0.
 */
export async function rollbackRealKillsFromGame(
  seasonId: string,
  battleStats: { player_id: string; pokemon_name: string; kos_dealt: number }[]
): Promise<void> {
  const [trackers, lines] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
  ]);
  if (trackers.length === 0) return;

  const formToTracker = buildFormToTrackerIndex(trackers, lines);

  for (const stat of applyKillDelta(battleStats, -1)) {
    const tracker = formToTracker.get(`${stat.player_id}::${stat.pokemon_name}`);
    if (!tracker) continue;

    // Atomic SQL decrement + audit log in one transaction, clamped at 0
    const updated = await applyTrackerProgressWithLog(tracker.id, 'real_kill', stat.kos_dealt, {
      note: 'Rollback: game deleted',
    });

    tracker.real_kills = updated.real_kills;
    tracker.total_kos = updated.total_kos;
  }
}

// Matchday side effects (participation tokens, early stage-3 lock, evolution
// points) are owned by src/lib/match/epb-matchday.ts, called from finalize.
