import { UserFacingError } from '@/lib/api/user-facing-error';
import { encodeDownstreamMatches, type DownstreamMatchSummary } from '@/lib/match/downstream-matches';

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
 * played or is in progress. Reopening the match would orphan that bracket path,
 * so the admin resets those matches first. `count` = such later matches. HTTP 409.
 * (An admin game edit or delete takes the match off `completed` the same way but
 * asks for approval instead: `GameChangeDownstreamPlayedError`.)
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

/**
 * An admin game edit or delete would take a completed bracket match off `completed` while the winner already played
 * later bracket matches. The change affects that played part of the bracket: the later matches have to be reset (as a
 * cascading match reset does) for the change to apply. Nothing was written. HTTP 409; `params.matches` lists the later
 * matches (`parseDownstreamMatches`), `params.count` their number. The admin approves, and the request is sent again
 * with the confirm flag.
 */
export class GameChangeDownstreamPlayedError extends UserFacingError<'game_change_downstream_played'> {
  constructor(matches: readonly DownstreamMatchSummary[]) {
    const count = matches.length;
    super(
      count === 1
        ? 'This change affects the rest of the bracket: 1 later bracket match was already played. It has to be reset for the change to apply. Nothing was changed yet; approve the reset to continue.'
        : `This change affects the rest of the bracket: ${count} later bracket matches were already played. They have to be reset for the change to apply. Nothing was changed yet; approve the reset to continue.`,
      {
        code: 'game_change_downstream_played',
        params: { count, matches: encodeDownstreamMatches(matches) },
        status: 409,
      },
    );
    this.name = 'GameChangeDownstreamPlayedError';
  }
}
