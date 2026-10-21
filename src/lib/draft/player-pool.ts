/**
 * A trainer's initial draft pool in a league, for the single-pool callers (team builder, dashboard team page,
 * team validation, `GET /api/drafts?season_id=`). Server only.
 *
 * A league WITHOUT groups reads exactly what these callers read before: the season's first pool
 * (`getDraftPoolBySeason`, one query). A league with groups has one initial pool per group, so "the season's pool"
 * does not exist there: `getDraftPoolBySeason` refuses (`GroupedLeaguePoolLookupError`, the one expected refusal,
 * branched on by type) and the trainer's own group's initial pool is read instead. A trainer in no group of a grouped
 * league (an admin, a spectator, a trainer not yet placed) has no pool: null.
 */
import 'server-only';

import {
  GroupedLeaguePoolLookupError,
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer } from '@/lib/supabase/queries/season-groups';
import type { DraftPool } from '@/types/draft';

/**
 * The initial pool `playerId` drafts in: the season's pool (no groups) or their group's initial pool (groups).
 * `playerId` null = nobody in particular: a league with groups then has no single pool (null). A page that is still
 * resolving its viewer passes a function that reads it: it is called (and awaited) only in a league with groups, so
 * a league without groups keeps its read in parallel with the session and no derived promise is ever left unawaited.
 */
export async function getInitialPoolForPlayer(
  seasonId: string,
  playerId: string | null | (() => PromiseLike<string | null>),
): Promise<DraftPool | null> {
  try {
    return await getDraftPoolBySeason(seasonId);
  } catch (err) {
    // Every other error propagates unchanged (the caller's safeErrorResponse / error boundary logs it).
    if (!(err instanceof GroupedLeaguePoolLookupError)) throw err;
  }
  const viewer = typeof playerId === 'function' ? await playerId() : playerId;
  if (viewer === null) return null;
  const group = await getSeasonGroupOfPlayer(seasonId, viewer);
  return group ? getDraftPoolBySeasonGroup(seasonId, group.id, 'initial') : null;
}
