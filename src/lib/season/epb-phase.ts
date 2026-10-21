import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupedPhaseWeekPlan } from '@/lib/tournament/phase-week-plan';

export interface EpbPhaseStatus {
  /** Primary stage tournament id (lowest stage_order), if any */
  tournament_id: string | null;
  total_rounds: number;
  /** Round numbers belonging to the Hinrunde (first half) */
  hinrunde_round_numbers: number[];
  /** At least one completed match in a Hinrunde round */
  has_first_half_matches: boolean;
  /** All Hinrunde rounds completed with every match finished */
  hinrunde_complete: boolean;
  /** Completed vs total matches per Hinrunde round number */
  completed_matches_by_round: Record<number, { completed: number; total: number }>;
}

function emptyPhaseStatus(): EpbPhaseStatus {
  return {
    tournament_id: null,
    total_rounds: 0,
    hinrunde_round_numbers: [],
    has_first_half_matches: false,
    hinrunde_complete: false,
    completed_matches_by_round: {},
  };
}

/**
 * The last round number of the Hinrunde (first half) of a primary stage with `totalRounds`
 * rounds: rounds `1..floor(totalRounds / 2)`. The one definition of the boundary, shared by the
 * redraft gate (`getEpbPhaseStatus`) and the Comeback Token earn window (`getHinrundeScope`).
 * 9 rounds -> 4; 1 round -> 0 (no Hinrunde).
 */
export function hinrundeLastRound(totalRounds: number): number {
  return Math.floor(totalRounds / 2);
}

/** Where the Hinrunde lives: the primary stage and its last Hinrunde round number. */
export interface HinrundeScope {
  /** Primary stage tournament id (lowest stage_order). */
  tournament_id: string;
  /** `hinrundeLastRound(rounds of the primary stage)`; 0 = the stage has no Hinrunde round. */
  last_round: number;
}

/**
 * The season's Hinrunde scope, with the same primary-stage choice and boundary as
 * `getEpbPhaseStatus`. Null when the season has no stage or its primary stage has no rounds yet
 * (no match can be in the Hinrunde then).
 */
export async function getHinrundeScope(seasonId: string): Promise<HinrundeScope | null> {
  const stages = await getStagesBySeasonId(seasonId);
  if (stages.length === 0) return null;
  const primary = stages[0];
  const rounds = await getRoundsByTournament(primary.id);
  if (rounds.length === 0) return null;
  return { tournament_id: primary.id, last_round: await primaryHinrundeCutoff(primary.id, rounds.length) };
}

/**
 * The last Hinrunde round of the primary stage. A phase whose groups mirror league groups takes it from its
 * planned weeks (`getGroupedPhaseWeekPlan`): its rounds are written week by week (each placement week only when
 * it is generated), so the rounds written so far undercount the phase. Any other stage: `hinrundeLastRound` of
 * its rounds, as before.
 */
async function primaryHinrundeCutoff(tournamentId: string, roundCount: number): Promise<number> {
  const plan = await getGroupedPhaseWeekPlan(tournamentId);
  return plan ? plan.firstHalfLastWeek : hinrundeLastRound(roundCount);
}

/**
 * Hinrunde = first half of rounds in the primary (lowest stage_order) stage; for a phase whose groups mirror
 * league groups, the first half of its planned weeks (`total_rounds` is then the planned week count).
 */
export async function getEpbPhaseStatus(seasonId: string): Promise<EpbPhaseStatus> {
  const stages = await getStagesBySeasonId(seasonId);
  if (stages.length === 0) return emptyPhaseStatus();

  const primary = stages[0];
  const rounds = await getRoundsByTournament(primary.id);
  if (rounds.length === 0) {
    return { ...emptyPhaseStatus(), tournament_id: primary.id };
  }

  const plan = await getGroupedPhaseWeekPlan(primary.id);
  const totalRounds = plan ? plan.totalWeeks : rounds.length;
  const hinrundeCutoff = plan ? plan.firstHalfLastWeek : hinrundeLastRound(rounds.length);
  // A grouped phase's Hinrunde is weeks 1..cutoff whether or not they are written yet (a missing week keeps it
  // incomplete); any other stage's Hinrunde is its written rounds up to the cutoff, as before.
  const hinrundeRoundNumbers = plan
    ? Array.from({ length: hinrundeCutoff }, (_, index) => index + 1)
    : rounds.filter((r) => r.round_number <= hinrundeCutoff).map((r) => r.round_number);

  if (hinrundeRoundNumbers.length === 0) {
    return {
      ...emptyPhaseStatus(),
      tournament_id: primary.id,
      total_rounds: totalRounds,
    };
  }

  const hinrundeRoundIds = new Set(
    rounds.filter((r) => hinrundeRoundNumbers.includes(r.round_number)).map((r) => r.id)
  );
  if (hinrundeRoundIds.size === 0) {
    return {
      ...emptyPhaseStatus(),
      tournament_id: primary.id,
      total_rounds: totalRounds,
      hinrunde_round_numbers: hinrundeRoundNumbers,
    };
  }

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, status, round_id, rounds!inner(round_number)')
    .eq('tournament_id', primary.id)
    .in('round_id', [...hinrundeRoundIds]);

  if (error) throw error;

  const completedMatchesByRound: Record<number, { completed: number; total: number }> = {};
  for (const rn of hinrundeRoundNumbers) {
    completedMatchesByRound[rn] = { completed: 0, total: 0 };
  }

  let hasFirstHalfMatches = false;
  for (const m of matches ?? []) {
    const roundNumber = (m.rounds as { round_number: number }).round_number;
    const bucket = completedMatchesByRound[roundNumber];
    if (!bucket) continue;
    bucket.total += 1;
    if (m.status === 'completed') {
      bucket.completed += 1;
      hasFirstHalfMatches = true;
    }
  }

  const hinrundeRounds = rounds.filter((r) => hinrundeRoundNumbers.includes(r.round_number));
  const writtenRoundNumbers = new Set(hinrundeRounds.map((r) => r.round_number));
  const allHinrundeRoundsWritten = hinrundeRoundNumbers.every((rn) => writtenRoundNumbers.has(rn));
  const allRoundsCompleted = hinrundeRounds.every((r) => r.status === 'completed');
  const allMatchesCompleted = hinrundeRounds.every((r) => {
    const bucket = completedMatchesByRound[r.round_number];
    return bucket && bucket.total > 0 && bucket.completed === bucket.total;
  });

  // Fallback: also accept completed match records when round status lags
  const records = await getCompletedMatchRecords(primary.id);
  const hinrundeRecords = records.filter((r) => hinrundeRoundNumbers.includes(r.round_number));
  if (hinrundeRecords.length > 0) {
    hasFirstHalfMatches = true;
  }

  const hinrundeComplete =
    hinrundeRounds.length > 0 &&
    allHinrundeRoundsWritten &&
    allRoundsCompleted &&
    (allMatchesCompleted ||
      (hinrundeRecords.length > 0 &&
        hinrundeRounds.every((r) => {
          const expected = completedMatchesByRound[r.round_number]?.total ?? 0;
          const done = hinrundeRecords.filter((rec) => rec.round_number === r.round_number).length;
          return expected === 0 || done >= expected;
        })));

  return {
    tournament_id: primary.id,
    total_rounds: totalRounds,
    hinrunde_round_numbers: hinrundeRoundNumbers,
    has_first_half_matches: hasFirstHalfMatches,
    hinrunde_complete: hinrundeComplete,
    completed_matches_by_round: completedMatchesByRound,
  };
}
