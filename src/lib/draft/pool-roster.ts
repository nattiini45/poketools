/**
 * The players a queue pool seats (server only): the season's participants, or for a league group's pool the
 * group's members. Shared by the routes that re-seat a pool in setup (`PATCH .../config`, `POST .../roll-order`),
 * so both agree on what a valid seat set is.
 */
import { getSeasonGroupMemberIds } from '@/lib/supabase/queries/season-groups';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import type { DraftPool } from '@/types/draft';

/** Player ids of the pool's roster, in the season's participant read order. Only ids are read. */
export async function poolRosterIds(pool: Pick<DraftPool, 'season_id' | 'season_group_id'>): Promise<string[]> {
  const participants = await getSeasonParticipants(pool.season_id);
  const groupMembers = pool.season_group_id ? await getSeasonGroupMemberIds(pool.season_group_id) : null;
  return participants.map((p) => p.id).filter((id) => !groupMembers || groupMembers.has(id));
}
