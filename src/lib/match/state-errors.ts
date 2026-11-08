import { UserFacingError } from '@/lib/api/user-facing-error';

/**
 * The match left the status the admin saw (a player, the auto-confirm cron or
 * another admin moved it first), so nothing was written. HTTP 409. `status` is
 * the status the match has now, when it could be read again; the message is
 * the same one the confirm-match route gives.
 */
export class MatchStateChangedError extends UserFacingError {
  constructor(status?: string) {
    super(
      status
        ? `The match changed to ${status} while you were editing it. Review it and try again.`
        : 'The match changed while you were editing it; your change was not applied. Reload and review it.',
      { code: 'match_state_changed', params: status ? { status } : undefined, status: 409 },
    );
    this.name = 'MatchStateChangedError';
  }
}

/**
 * A later bracket match that this match's winner advanced into was already
 * played or is in progress. Reopening the match (or changing a game of it, which
 * takes it off `completed` the same way) would orphan that bracket path, so the
 * admin resets those matches first. `count` = such later matches. HTTP 409.
 */
export class MatchReopenDownstreamPlayedError extends UserFacingError {
  constructor(count: number) {
    super(
      count === 1
        ? 'This match cannot be reopened: 1 later bracket match was already played. Reset that match first.'
        : `This match cannot be reopened: ${count} later bracket matches were already played. Reset those matches first.`,
      { code: 'match_reopen_downstream_played', params: { count }, status: 409 },
    );
    this.name = 'MatchReopenDownstreamPlayedError';
  }
}
