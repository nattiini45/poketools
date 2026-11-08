/**
 * The guard of the player routes of a running format (`/api/seasons/[id]/format/me`, `.../actions/*`, `.../challenges/*`):
 * the caller must be a participant of the league: on its roster or enrolled in a phase of it still in play (`isSeasonPlayer`). Like the other guards it is live (the ban / suspension check of
 * `requirePlayer`) and it never trusts the session copy.
 *
 * Site admins get no bypass here: a player route acts only for the session player, and the actor id never comes from the
 * body, the path or the query. (An admin who also plays is a member like any other player.)
 *
 * `assertSeasonOpenForPlay` is the write gate for closed leagues: a completed or archived league takes no more moves.
 * Reads (`me`) and the admin routes stay open, so a player can still look at the history and an admin can correct it.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { refuse } from '@/lib/format-engine/runtime/refusal';
import { getSeasonPlayState } from '@/lib/supabase/queries/format-runtime-reads';
import { isSeasonPlayer } from '@/lib/supabase/queries/seasons';
import { isValidUuid } from '@/lib/utils/uuid';
import type { SessionPlayer } from '@/types/auth';
import { requirePlayer } from './helpers';

export interface SeasonMember {
  player: SessionPlayer;
  /** The league id in lower case (what the database returns), whatever case the path used. */
  seasonId: string;
}

/**
 * Requires a signed-in player in good standing who takes part in the league `rawId`. A malformed id is a 404
 * `INVALID_SEASON_ID` for everyone; a player who is not (or no longer) a participant is a 403 `format_not_participant`.
 * The player check comes first, so a banned player is refused before the participant read.
 */
export async function requireSeasonMember(rawId: string): Promise<SeasonMember> {
  const player = await requirePlayer();
  if (!isValidUuid(rawId)) throw new UserFacingError('League not found', { status: 404, code: 'INVALID_SEASON_ID' });
  const seasonId = rawId.toLowerCase();
  if (!(await isSeasonPlayer(seasonId, player.playerId))) throw refuse('format_not_participant');
  return { player, seasonId };
}

/**
 * Refuses a player write in a league that is completed or archived (409 `format_season_closed`). `upcoming` and `active`
 * are open on purpose: a gift pick may come before the first round, the window of the action is the format's own gate.
 * An unknown league is a 404.
 */
export async function assertSeasonOpenForPlay(seasonId: string): Promise<void> {
  const state = await getSeasonPlayState(seasonId);
  if (state === null) throw new UserFacingError('League not found', { status: 404, code: 'SEASON_NOT_FOUND' });
  if (state.status === 'completed' || state.archived) throw refuse('format_season_closed');
}
