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
import {
  getByeRoundsByTournamentIds,
  getRoundsByTournament,
  getSwissByeRoundsBySeason,
  type ByeRound,
} from '@/lib/supabase/queries/rounds';
import { formatScoresByes, groupRoundsByStage, scoringByeRecords } from './byes';
import type { ByeRecord } from './types';

/**
 * The byes of `tournament` that count in its standings: its stored Swiss byes
 * as win records, nothing for any other bracket type and nothing for a stage of
 * an Evolution Point Buy league (`season_format_type`, as `getTournamentById`
 * joins it). Anything but a scoring Swiss tournament returns before a round is
 * read, so callers pay no query for the round robin, league, elimination and
 * Evolution Point Buy standings that never score a bye.
 */
export async function loadScoringByes(tournament: {
  id: string;
  bracket_type: BracketType | null | undefined;
  season_format_type?: string | null;
}): Promise<ByeRecord[]> {
  if (tournament.bracket_type !== 'swiss' || !formatScoresByes(tournament.season_format_type)) return [];
  return scoringByeRecords(tournament.bracket_type, await getRoundsByTournament(tournament.id));
}

/**
 * The stored bye rounds of a season's Swiss stages, keyed by stage id, in ONE rounds read (the stage filter runs
 * in the database). A stage without a Swiss round is absent from the map.
 */
export async function loadSeasonSwissByeRounds(seasonId: string): Promise<Map<string, ByeRound[]>> {
  return groupRoundsByStage(await getSwissByeRoundsBySeason(seasonId));
}

/**
 * `loadScoringByes` for many tournaments at once: one rounds read for all the Swiss ones, none when there is no
 * Swiss tournament. Every tournament in the list has an entry (empty for a non-Swiss one), so a caller indexes the
 * result without a fallback.
 */
export async function loadScoringByesBatch(
  tournaments: readonly { id: string; bracket_type?: BracketType | null; season_format_type?: string | null }[],
): Promise<Map<string, ByeRecord[]>> {
  const swissIds = tournaments
    .filter((t) => t.bracket_type === 'swiss' && formatScoresByes(t.season_format_type))
    .map((t) => t.id);
  const roundsByTournament = swissIds.length > 0 ? await getByeRoundsByTournamentIds(swissIds) : new Map<string, ByeRound[]>();
  return new Map(
    tournaments.map((t) => [t.id, scoringByeRecords(t.bracket_type, roundsByTournament.get(t.id) ?? [])] as const),
  );
}

/** Keep the byes of rounds up to and including `roundNumber` (a "through round N" table). */
export function byesThroughRound(byes: readonly ByeRecord[], roundNumber: number): ByeRecord[] {
  return byes.filter((bye) => bye.round_number <= roundNumber);
}
