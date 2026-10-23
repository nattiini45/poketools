/**
 * Server-side loader for the byes a tournament's standings score.
 *
 * Standings callers that do not already hold the tournament's rounds call
 * this and pass the result as `StandingsOptions.byes`. A page that did load
 * the rounds uses the pure `scoringByeRecords` (byes.ts) on them instead.
 *
 * Server-only: imports a service-role query module.
 */

import type { BracketType } from '@/types/tournament';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { scoringByeRecords } from './byes';
import type { ByeRecord } from './types';

/**
 * The byes of `tournament` that count in its standings: its stored Swiss byes
 * as win records, nothing for any other bracket type. Anything but a Swiss
 * tournament returns before a round is read, so callers pay no query for the
 * round robin, league and elimination standings that never score a bye.
 */
export async function loadScoringByes(tournament: {
  id: string;
  bracket_type: BracketType | null | undefined;
}): Promise<ByeRecord[]> {
  if (tournament.bracket_type !== 'swiss') return [];
  return scoringByeRecords(tournament.bracket_type, await getRoundsByTournament(tournament.id));
}

/** Keep the byes of rounds up to and including `roundNumber` (a "through round N" table). */
export function byesThroughRound(byes: readonly ByeRecord[], roundNumber: number): ByeRecord[] {
  return byes.filter((bye) => bye.round_number <= roundNumber);
}
