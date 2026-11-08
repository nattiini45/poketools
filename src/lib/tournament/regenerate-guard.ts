import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Tournament } from '@/types/tournament';

/**
 * Refuses (409 `bracket_regenerate_phase_completed`) a bracket regeneration of a phase of a custom league whose stage has
 * already ended: the regeneration wipes the rounds and matches and starts the phase again, which would silently
 * reactivate a phase the format has already closed and advanced players out of. The admin reopens the phase first.
 * A phase of a legacy league (no attached format) keeps the old behaviour. Pure, so the route runs it before anything
 * is written (the forced-start audit of `assertPhaseReadyForFirstRound` is a write).
 */
export function assertBracketMayBeRegenerated(tournament: Pick<Tournament, 'id' | 'status' | 'season_id' | 'season_format_type'>): void {
  if (tournament.status !== 'completed' || !isKitCandidate(tournament)) return;
  throw new UserFacingError(
    'This phase has already ended, so its bracket cannot be regenerated. Reopen the phase first, then regenerate the bracket.',
    { code: 'bracket_regenerate_phase_completed', status: 409 },
  );
}
