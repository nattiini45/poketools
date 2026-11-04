/**
 * Advancement of a kit league between two of its phases: the edge of the attached format that joins their stages,
 * run over the source stage's own table (`resolveAdvancement`). Server only: reads the format's spec and seed.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getKitPhases, getOutcomesByPhases } from '@/lib/supabase/queries/format-engine';
import type { ByeRecord, MatchRecord } from '@/lib/tournament/types';
import { resolveAdvancement, type AdvancedPlayer } from './advancement';
import { stageOf } from './load';
import { coinFlipDraws, computeStageStandings, type KitOutcome } from './standings';

export interface KitAdvanceInput {
  seasonId: string;
  sourcePhaseId: string;
  targetPhaseId: string;
  /** The source phase's players, names and completed matches, as the legacy enrollment reads them. */
  participantIds: string[];
  participantNames: Record<string, string>;
  matches: MatchRecord[];
  byes: ByeRecord[];
  /** Group number per player of the source phase. */
  groupOf: Record<string, number>;
  /** The admin's list for a `manual_list` selection. */
  manualList?: readonly string[];
}

/**
 * The players the format's edge moves from the source phase to the target, in their target seed order, or null when
 * the league does not advance on the kit (no format, engine not `kit`, or no edge joins the two stages).
 */
export async function kitAdvancingPlayers(input: KitAdvanceInput): Promise<AdvancedPlayer[] | null> {
  const format = await getSeasonFormat(input.seasonId);
  if (format === null || format.engine !== 'kit') return null;
  const phases = await getKitPhases(input.seasonId);
  const source = phases.find((row) => row.id === input.sourcePhaseId);
  const target = phases.find((row) => row.id === input.targetPhaseId);
  if (!source || !target) return null;
  const edge = format.spec.edges.find((e) => e.from === source.format_stage_key && e.to === target.format_stage_key);
  if (!edge) return null;

  const [stage, outcomeRows] = await Promise.all([stageOf(source), getOutcomesByPhases([source.id])]);
  const outcomes: Record<string, KitOutcome> = {};
  for (const row of outcomeRows) outcomes[row.match_id] = { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
  const table = computeStageStandings({
    stage,
    participantIds: input.participantIds,
    participantNames: input.participantNames,
    matches: input.matches,
    outcomes,
    byes: input.byes,
    coinFlips: coinFlipDraws(format.seed, stage.key, input.participantIds),
  });

  const result = resolveAdvancement({
    edge,
    table,
    groupOf: input.groupOf,
    manualList: input.manualList,
    seed: format.seed,
  });
  if (result.awaitingManualList) {
    throw new UserFacingError('This advancement needs the list of players who move on.', {
      code: 'advance_manual_list_required',
      params: { edge: edge.key },
      status: 409,
    });
  }
  if (result.issues.length > 0) {
    throw new UserFacingError('The advancement condition could not be checked for every player.', {
      code: 'advance_threshold_failed',
      params: { edge: edge.key, count: result.issues.length, issue: result.issues[0].issue.code },
      status: 422,
    });
  }
  return result.players;
}
