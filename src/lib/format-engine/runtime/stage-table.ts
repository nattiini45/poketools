/**
 * The ranked table of one phase of a kit league for the runtime (event targets that read `wins`, the tie checks at the
 * end of a stage). It scores completed matches, byes, outcomes and the league's adjustments like the public table does,
 * without battle stats (the advance route ranks the same way). Server only.
 */
import 'server-only';

import { getOutcomesByPhases } from '@/lib/supabase/queries/format-engine';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { byeRecordsFromRounds } from '@/lib/tournament/byes';
import { standingAdjustments } from './adjustments';
import { phaseById, type KitContext } from './load';
import { stageMetricsFor } from './metrics';
import { coinFlipDraws, computeStageStandings, type KitOutcome, type KitStanding } from '../standings';
import type { PlayerRow } from './types';

export async function loadStageTable(ctx: KitContext, phaseId: string): Promise<KitStanding[] | null> {
  const phase = phaseById(ctx, phaseId);
  if (phase === undefined) return null;
  const [matches, rounds, outcomeRows] = await Promise.all([
    getCompletedMatchRecords(phaseId),
    getRoundsByTournament(phaseId),
    getOutcomesByPhases([phaseId]),
  ]);
  const outcomes: Record<string, KitOutcome> = {};
  for (const row of outcomeRows) outcomes[row.match_id] = { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
  const { adjustments, manualOrder } = standingAdjustments(ctx.state.adjustments, new Map([[phase.stage.key, phaseId]]));
  const metrics = stageMetricsFor(ctx.def, ctx.state, ctx.seed, phase.stage.key, phase.members);
  return computeStageStandings({
    stage: phase.stage,
    participantIds: phase.members,
    participantNames: {},
    matches,
    outcomes,
    byes: byeRecordsFromRounds(rounds),
    coinFlips: coinFlipDraws(ctx.seed, phase.stage.key, phase.members),
    seed: ctx.seed,
    pointAdjustments: adjustments[phaseId],
    manualOrder: manualOrder[phaseId],
    ...(metrics ? { metricDefs: metrics.defs, placements: metrics.placements, playerRefs: metrics.playerRefs } : {}),
  });
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
