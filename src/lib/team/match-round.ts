/**
 * The round a match belongs to, for the team rules of a kit league: a match-bound team check (the live validation, a
 * match-prep save, an edit of a team registered for a match) is judged by the rules of the match's round, not by the
 * latest round the phase has generated, so a week-3 match opened in week 4 is still checked as week 3.
 *
 * `roundNumberOfMatch` is for a caller that has already read the match (match-prep); `roundOfMatch` also reads the match
 * and answers whether it belongs to the tournament the caller names. Server only.
 */
import 'server-only';

import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import type { MatchWithPlayers } from '@/types/match';

/** The round number of a match's round, or undefined when the round row is gone. */
export async function roundNumberOfMatch(match: Pick<MatchWithPlayers, 'round_id'>): Promise<number | undefined> {
  const round = await getRoundById(match.round_id);
  return round?.round_number;
}

export type MatchRound =
  | { status: 'ok'; match: MatchWithPlayers; roundNumber: number | undefined }
  /** No such match, or a match of another tournament (the two are told apart by nobody: no existence leak). */
  | { status: 'not_found' };

/** The match and its round number, provided the match belongs to `tournamentId`. */
export async function roundOfMatch(matchId: string, tournamentId: string): Promise<MatchRound> {
  const match = await getMatchById(matchId);
  if (match === null || match.tournament_id !== tournamentId) return { status: 'not_found' };
  return { status: 'ok', match, roundNumber: await roundNumberOfMatch(match) };
}

/** Whether `playerId` plays the match. */
export function isMatchParticipant(match: Pick<MatchWithPlayers, 'player_1_id' | 'player_2_id'>, playerId: string): boolean {
  return match.player_1_id === playerId || match.player_2_id === playerId;
}
