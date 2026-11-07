/**
 * The ranked table of one phase of a kit league for the runtime (event targets that read `wins`, the tie checks at the
 * end of a stage). It scores completed matches, byes, outcomes and the league's adjustments like the public table does.
 * Games are counted (`games_played`) and, in a round robin stage, kills are read from the battle stats
 * (`kill_differential`), as the public table does; the advance route ranks the same way. Server only.
 */
import 'server-only';

import { mappedBracketType } from '@/lib/format-kit/engine/plan';
import { getOutcomesByPhases, getPhaseBattleStats, getPhaseGameCounts } from '@/lib/supabase/queries/format-engine';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { scoringByeRecords } from '@/lib/tournament/byes';
import { loadSeedsAndRatings } from '../load';
import { standingAdjustments } from './adjustments';
import { phaseById, phasesOfStageKey, type KitContext } from './load';
import { stageMetricsFor } from './metrics';
import { coinFlipDraws, computeStageStandings, kitOutcomesByMatch, stageCountsKills, type KitStanding } from '../standings';
import type { PlayerRow } from './types';

export async function loadStageTable(ctx: KitContext, phaseId: string): Promise<KitStanding[] | null> {
  const phase = phaseById(ctx, phaseId);
  if (phase === undefined) return null;
  const [matches, rounds, outcomeRows, gameCounts, battleStats, seedsAndRatings] = await Promise.all([
    getCompletedMatchRecords(phaseId),
    getRoundsByTournament(phaseId),
    getOutcomesByPhases([phaseId]),
    getPhaseGameCounts([phaseId]),
    // Kills count in a round robin stage only, like the public table.
    stageCountsKills(phase.stage) ? getPhaseBattleStats([phaseId]) : Promise.resolve([]),
    loadSeedsAndRatings([{ phaseId, stage: phase.stage, playerIds: phase.members }]),
  ]);
  const { adjustments, manualOrder } = standingAdjustments(ctx.state.adjustments, new Map([[phase.stage.key, phaseId]]));
  const metrics = stageMetricsFor(ctx.def, ctx.state, ctx.seed, phase.stage.key, phase.members);
  return computeStageStandings({
    stage: phase.stage,
    participantIds: phase.members,
    participantNames: {},
    matches,
    outcomes: kitOutcomesByMatch(outcomeRows),
    // `games_played` counts the matches' games, like the public table.
    gameCounts,
    battleStats,
    // Only a Swiss stage scores its byes, like the public table (`scoringByeRecords`).
    byes: scoringByeRecords(mappedBracketType(phase.stage.pairing), rounds),
    coinFlips: coinFlipDraws(ctx.seed, phase.stage.key, phase.members),
    seed: ctx.seed,
    pointAdjustments: adjustments[phaseId],
    manualOrder: manualOrder[phaseId],
    seeds: seedsAndRatings.seeds?.[phaseId],
    ratings: seedsAndRatings.ratings,
    ...(metrics
      ? { metricDefs: metrics.defs, placements: metrics.placements, playerRefs: metrics.playerRefs, relations: metrics.relations }
      : {}),
  });
}

/**
 * The advancement-row fields of every player of a stage, for `PlanOptions.rows`. A stage that repeats per group
 * (`foreach_group`) is several phases under one key: each player's row comes from the table of their own group, so a
 * target `where` on `wins` or `rank` reads the right row for every group (not the first group's only). Without a stage
 * key the first phase is the league's (an event with no stage). Undefined when no phase matches.
 */
export async function loadStageRows(ctx: KitContext, stageKey: string | undefined): Promise<Record<string, PlayerRow> | undefined> {
  const phases = stageKey === undefined ? ctx.phases.slice(0, 1) : phasesOfStageKey(ctx, stageKey);
  if (phases.length === 0) return undefined;
  const rows: Record<string, PlayerRow> = {};
  let found = false;
  for (const phase of phases) {
    const table = await loadStageTable(ctx, phase.id);
    if (table === null) continue;
    found = true;
    Object.assign(rows, playerRowsOf(table));
  }
  return found ? rows : undefined;
}

/** The advancement-row fields of a table, by player, for `PlanOptions.rows`. */
export function playerRowsOf(table: readonly KitStanding[]): Record<string, PlayerRow> {
  const out: Record<string, PlayerRow> = {};
  for (const row of table) {
    out[row.player_id] = {
      points: row.points,
      wins: row.wins,
      losses: row.losses,
      games_played: row.games_played,
      rank: row.rank,
      faints_dealt: row.faints_dealt,
      faints_taken: row.faints_taken,
      kill_differential: row.kill_differential,
      buchholz: row.buchholz,
    };
  }
  return out;
}
