import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';

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

/** Hinrunde = first half of rounds in the primary (lowest stage_order) stage. */
export async function getEpbPhaseStatus(seasonId: string): Promise<EpbPhaseStatus> {
  const stages = await getStagesBySeasonId(seasonId);
  if (stages.length === 0) return emptyPhaseStatus();

  const primary = stages[0];
  const rounds = await getRoundsByTournament(primary.id);
  if (rounds.length === 0) {
    return { ...emptyPhaseStatus(), tournament_id: primary.id };
  }

  const totalRounds = rounds.length;
  const hinrundeCutoff = Math.floor(totalRounds / 2);
  const hinrundeRoundNumbers = rounds
    .filter((r) => r.round_number <= hinrundeCutoff)
    .map((r) => r.round_number);

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
