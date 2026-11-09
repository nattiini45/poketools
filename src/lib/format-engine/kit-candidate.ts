/**
 * Whether a tournament can run a kit format. Pure and light on purpose (types only): the match finalize and the game
 * pipeline ask it on every completion and import the format runtime only when the answer is yes.
 */
import type { Tournament } from '@/types/tournament';

/** The slice of a tournament row the format runtime needs. */
export type HookTournament = Pick<Tournament, 'id' | 'season_id' | 'season_format_type'>;

/** Whether the tournament is a phase of a custom league: the only leagues that can run a kit format. */
export function isKitCandidate(tournament: HookTournament): tournament is HookTournament & { season_id: string } {
  return tournament.season_id != null && tournament.season_format_type === 'custom';
}
