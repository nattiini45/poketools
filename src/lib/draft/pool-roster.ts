/**
 * The players a queue pool seats (server only): the season's participants, or for a league group's pool the
 * group's members. Shared by every route that seats a queue pool (`POST /api/drafts`, `PATCH .../config`,
 * `POST .../roll-order`), so they agree on what a valid seat set is.
 */
import 'server-only';

import { getSeasonGroupMemberIds } from '@/lib/supabase/queries/season-groups';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import type { DraftPool } from '@/types/draft';

/**
 * Player ids of a season's roster, in the participant read order, narrowed to `groupMembers` when the pool belongs to
 * a league group (`null` = the whole season). For a caller that already holds the group's members; only ids are read.
 */
export async function seasonRosterIds(seasonId: string, groupMembers: ReadonlySet<string> | null): Promise<string[]> {
  const participants = await getSeasonParticipants(seasonId);
  return participants.map((p) => p.id).filter((id) => !groupMembers || groupMembers.has(id));
}

/** Player ids of the pool's roster, in the season's participant read order. Only ids are read. */
export async function poolRosterIds(pool: Pick<DraftPool, 'season_id' | 'season_group_id'>): Promise<string[]> {
  const groupMembers = pool.season_group_id ? await getSeasonGroupMemberIds(pool.season_group_id) : null;
  return seasonRosterIds(pool.season_id, groupMembers);
}
