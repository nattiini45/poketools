/**
 * EPB matchday orchestration (cosmo → stage recheck → lock → EP → snapshots).
 * Called from match finalize. Own writes are all-or-nothing: on failure the
 * orchestrator rolls back tracker / log / event / snapshot mutations it made
 * this run, with distinct logged errors per failure cause.
 */

import {
  clearExpiredSuspensions,
  getSeasonTrackers,
  updateTracker,
} from '@/lib/supabase/queries/evolutions';
import { getSeasonEvolutionEvents } from '@/lib/supabase/queries/evolution-events';
import { getSeasonProgressLog } from '@/lib/supabase/queries/progress-log';
import {
  deleteMatchSnapshots,
  insertMatchSnapshots,
  type SnapshotInput,
} from '@/lib/supabase/queries/match-snapshots';
import { getSeasonLineThresholds, type LineThresholds } from '@/lib/draft/epb-thresholds';
import { isLineBrought } from '@/lib/draft/epb-team-validation';
import {
  awardCosmoPoint,
  checkEarlyStage3Lock,
} from '@/lib/draft/progress-engine';
import { awardEvolutionPointForMatchday } from '@/lib/draft/evolution-points-engine';
import { recheckEpbStages } from '@/lib/match/evolution-match-evaluator';
import { lineLookup } from '@/lib/match/epb-stage-resolution';
import { epbPack } from '@/lib/format-pack';
import { supabase } from '@/lib/supabase/client';
import { getRegisteredSpeciesByMatch } from '@/lib/supabase/queries/match-prep-teams';
import type { BattleStat } from '@/types/game';
import type {
  EvolutionEventRecord,
  EvolutionTracker,
  EvoProgressEntry,
} from '@/types/evolution';
import type { MatchWithPlayers } from '@/types/match';

export interface EpbMatchdayInput {
  match: MatchWithPlayers;
  seasonId: string;
  matchday: number;
  battleStats: BattleStat[];
}

/** Per-source progress gained by one tracker this matchday. */
interface MatchdayDeltas {
  real_kills: number;
  draft_tokens: number;
  kill_tokens: number;
  cosmo_points: number;
  /** Sum of all match-attributed sources (admin corrections excluded) */
  total: number;
}

function sumMatchdayDeltas(entries: EvoProgressEntry[]): MatchdayDeltas {
  const deltas: MatchdayDeltas = {
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    total: 0,
  };
  for (const entry of entries) {
    switch (entry.source) {
      case 'real_kill':
        deltas.real_kills += entry.amount;
        break;
      case 'draft_token':
        deltas.draft_tokens += entry.amount;
        break;
      case 'kill_token':
        deltas.kill_tokens += entry.amount;
        break;
      case 'cosmo_point':
        deltas.cosmo_points += entry.amount;
        break;
      // admin_correction: not attributed to this match — lands in
      // progress_before instead of the animated per-match delta
      default:
        continue;
    }
    deltas.total += entry.amount;
  }
  return deltas;
}

/**
 * Build snapshot rows for both players of a match — pure and unit-testable.
 *
 * All progress numbers derive from evo_progress_log matchday deltas, NOT
 * from battle-stat name matching or cumulative tracker fields. This makes
 * the writer immune to hook ordering (participation tokens awarded earlier in this
 * finalize are isolated by source) and to form renames from evolutions
 * (KOs land in the log under the tracker id regardless of form name).
 *
 * Assumes one match per player per matchday (EPB round robin) — the
 * matchday-scoped log deltas are attributed wholly to this match.
 *
 * `brought` follows the participation rule: a form of the line is in the player's
 * registered team (`registeredByPlayer`, player id → species) or in the player's battle rows.
 */
export function buildSnapshotRows(
  matchId: string,
  matchday: number,
  playerIds: string[],
  trackers: EvolutionTracker[],
  lines: LineThresholds[],
  logEntries: EvoProgressEntry[],
  evolutionEvents: EvolutionEventRecord[],
  battleStats: Pick<BattleStat, 'player_id' | 'pokemon_name'>[],
  registeredByPlayer: ReadonlyMap<string, readonly string[]> = new Map(),
): SnapshotInput[] {
  const lineOf = lineLookup(lines);
  const logByTracker = new Map<string, EvoProgressEntry[]>();
  for (const entry of logEntries) {
    if (!entry.tracker_id) continue;
    const list = logByTracker.get(entry.tracker_id) ?? [];
    list.push(entry);
    logByTracker.set(entry.tracker_id, list);
  }

  const snapshots: SnapshotInput[] = [];

  for (const playerId of playerIds) {
    const playerTrackers = trackers.filter((t) => t.player_id === playerId);

    for (const tracker of playerTrackers) {
      const deltas = sumMatchdayDeltas(logByTracker.get(tracker.id) ?? []);

      // progress_before excludes everything gained this matchday
      const progressBefore = Math.max(0, tracker.total_kos - deltas.total);

      // Earliest non-devolution event this matchday = the form that
      // entered the match (pre-evolution). Events arrive ascending. Matched by
      // tracker id (a player may own both branches of one base); events
      // without a tracker id fall back to the base name.
      const evolutionEvent = evolutionEvents.find((e) =>
        e.tracker_id
          ? e.tracker_id === tracker.id
          : e.player_id === playerId && e.base_pokemon === tracker.base_pokemon
      );

      const line = lineOf(tracker);
      const registeredSpecies = registeredByPlayer.get(playerId) ?? null;
      const legacyForms = new Set([tracker.base_pokemon, tracker.current_form, tracker.locked_stage3_pokemon]);
      const brought = line
        ? isLineBrought(
            line,
            { playerId, registeredSpecies, battleStats },
            tracker.locked_stage3_pokemon
          )
        : (registeredSpecies ?? []).some((species) => legacyForms.has(species)) ||
          battleStats.some((s) => s.player_id === playerId && legacyForms.has(s.pokemon_name));

      snapshots.push({
        match_id: matchId,
        player_id: playerId,
        tracker_id: tracker.id,
        base_pokemon: tracker.base_pokemon,
        // Branch-exact line (a player may own both lines of one base); null for legacy leagues
        line_id: tracker.line_id ?? null,
        // Form actually used in the match: pre-evolution form when the
        // line evolved this matchday, else the current form
        species_at_match: evolutionEvent?.previous_form ?? tracker.current_form,
        stage_at_match: evolutionEvent?.previous_stage ?? tracker.current_stage,
        progress_before: progressBefore,
        progress_after: tracker.total_kos,
        real_kos: deltas.real_kills,
        draft_tokens_delta: deltas.draft_tokens,
        kill_tokens_delta: deltas.kill_tokens,
        cosmo_points_delta: deltas.cosmo_points,
        evolution_triggered: evolutionEvent !== undefined,
        // clearExpiredSuspensions ran first in the hook block, so only this
        // matchday's checkEarlyStage3Lock can produce matchday + suspendMatchdays
        suspension_triggered:
          tracker.suspended_until_matchday === matchday + epbPack.stageLock.suspendMatchdays,
        brought,
      });
    }
  }

  return snapshots;
}

/**
 * Write point-in-time evolution snapshots for both players in a match.
 * Called after EPB hooks so progress_after includes participation tokens etc.
 */
async function writeMatchSnapshots(
  matchId: string,
  seasonId: string,
  matchday: number,
  playerIds: string[],
  battleStats: BattleStat[],
  evolutionEvents: EvolutionEventRecord[],
  registeredByPlayer: ReadonlyMap<string, readonly string[]>,
): Promise<void> {
  const [trackers, lines, logEntries] = await Promise.all([
    getSeasonTrackers(seasonId),
    getSeasonLineThresholds(seasonId),
    getSeasonProgressLog(seasonId, matchday),
  ]);

  const snapshots = buildSnapshotRows(
    matchId,
    matchday,
    playerIds,
    trackers,
    lines,
    logEntries,
    evolutionEvents,
    battleStats,
    registeredByPlayer,
  );

  await insertMatchSnapshots(matchId, snapshots);
}

function trackerSnapshotFields(tracker: EvolutionTracker) {
  return {
    current_form: tracker.current_form,
    current_stage: tracker.current_stage,
    total_kos: tracker.total_kos,
    evolved_at: tracker.evolved_at,
    real_kills: tracker.real_kills,
    draft_tokens: tracker.draft_tokens,
    kill_tokens: tracker.kill_tokens,
    cosmo_points: tracker.cosmo_points,
    suspended_until_matchday: tracker.suspended_until_matchday,
    evolution_points_awarded: tracker.evolution_points_awarded,
    locked_stage3_pokemon: tracker.locked_stage3_pokemon,
  };
}

/**
 * Roll back matchday-hook writes made at/after `runStartedAt` for the
 * players in this match only. EPB round-robin has one match per player per
 * matchday, so scoping by player_id / their tracker ids avoids clobbering
 * concurrent finalizations for other pairings that share the same matchday.
 */
async function rollbackMatchdayWrites(
  matchId: string,
  seasonId: string,
  matchday: number,
  baseline: EvolutionTracker[],
  playerIds: string[],
  runStartedAt: string
): Promise<void> {
  const playerIdSet = new Set(playerIds);
  const playerTrackers = baseline.filter((t) => playerIdSet.has(t.player_id));
  const trackerIds = playerTrackers.map((t) => t.id);

  try {
    await deleteMatchSnapshots(matchId);
  } catch (err) {
    console.error('EPB matchday rollback: failed to delete match snapshots', err);
  }

  try {
    const { error } = await supabase
      .from('evolution_events')
      .delete()
      .eq('season_id', seasonId)
      .eq('matchday', matchday)
      .in('player_id', playerIds)
      .gte('created_at', runStartedAt);
    if (error) throw error;
  } catch (err) {
    console.error('EPB matchday rollback: failed to delete evolution events', err);
  }

  if (trackerIds.length > 0) {
    try {
      const { error } = await supabase
        .from('evo_progress_log')
        .delete()
        .eq('season_id', seasonId)
        .eq('matchday', matchday)
        .in('tracker_id', trackerIds)
        .gte('created_at', runStartedAt);
      if (error) throw error;
    } catch (err) {
      console.error('EPB matchday rollback: failed to delete progress log rows', err);
    }
  }

  for (const tracker of playerTrackers) {
    try {
      await updateTracker(tracker.id, trackerSnapshotFields(tracker));
    } catch (err) {
      console.error(
        `EPB matchday rollback: failed to restore tracker ${tracker.id}`,
        err
      );
    }
  }
}

/**
 * Run EPB matchday side effects for a newly completed match.
 * On failure, rolls back this run's writes then rethrows so the caller can
 * log without leaving half-applied bookkeeping.
 */
export async function runEpbMatchdayHooks(input: EpbMatchdayInput): Promise<void> {
  const { match, seasonId, matchday, battleStats } = input;
  const playerIds = [match.player_1_id, match.player_2_id];

  // Registered teams decide "brought" for participation tokens. A failed read throws
  // before any write: it is never read as "no team".
  const [baseline, registeredByPlayer] = await Promise.all([
    getSeasonTrackers(seasonId),
    getRegisteredSpeciesByMatch(match.id),
  ]);
  const runStartedAt = new Date().toISOString();

  try {
    // 1. Clear suspensions served in earlier matchdays
    await clearExpiredSuspensions(seasonId, matchday);

    // 2. Participation tokens — only when a participation line (format pack) was brought:
    // in the player's registered team or in the match's battle data (participation rule)
    for (const playerId of playerIds) {
      await awardCosmoPoint(seasonId, matchday, {
        playerId,
        registeredSpecies: registeredByPlayer.get(playerId) ?? null,
        battleStats,
      });
    }

    // 3. Re-resolve stages after cosmo/token contributions so evolution
    // events and the early stage-3 lock see the updated totals
    await recheckEpbStages(seasonId, playerIds, { matchday });

    // 4. Early stage lock for this match's players only (format pack
    // `epb.stageLock`: lock stage reached by its matchday → suspended)
    await checkEarlyStage3Lock(seasonId, matchday, playerIds);

    // 5. Evolution points: max 1 per player per matchday, deduped on
    // dispute re-confirm via evo_progress_log audit rows
    const events = await getSeasonEvolutionEvents(seasonId, matchday);
    const evolved = new Set(
      events.filter((e) => !e.is_devolution).map((e) => e.player_id)
    );
    await awardEvolutionPointForMatchday(
      seasonId,
      match.player_1_id,
      matchday,
      evolved.has(match.player_1_id)
    );
    await awardEvolutionPointForMatchday(
      seasonId,
      match.player_2_id,
      matchday,
      evolved.has(match.player_2_id)
    );

    // 6. Write match evolution snapshots for historical accuracy.
    await writeMatchSnapshots(
      match.id,
      seasonId,
      matchday,
      playerIds,
      battleStats,
      events.filter((e) => !e.is_devolution),
      registeredByPlayer,
    );
  } catch (err) {
    console.error('EPB matchday hooks failed; rolling back own writes', err);
    await rollbackMatchdayWrites(
      match.id,
      seasonId,
      matchday,
      baseline,
      playerIds,
      runStartedAt
    );
    throw err;
  }
}
