/**
 * `format_notifications` (migration 20261108090000): the in-app inbox of kit leagues. Service-role reads and writes only (RLS
 * on, no policies). The rows are written in the database, in the transaction of their event (`format_fire_event_notify` and the
 * `format_challenges` trigger); this module only reads them, marks them read and purges old ones. Callers pass the player id
 * from a live `require*` guard, never from a request.
 */
import 'server-only';

import type { StoredNotification } from '@/lib/format-engine/notifications/views';
import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';

const INBOX_COLUMNS = 'id, season_id, kind, payload, created_at, read_at';

/** One page, newest first. `hasMore`: a row exists after the page (one row more than `limit` is read to learn that). */
export async function listFormatNotifications(
  playerId: string,
  limit: number,
  offset: number,
): Promise<{ rows: StoredNotification[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from('format_notifications')
    .select(INBOX_COLUMNS)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);
  if (error) throw error;
  return { rows: data.slice(0, limit), hasMore: data.length > limit };
}

export async function countUnreadFormatNotifications(playerId: string): Promise<number> {
  const { count, error } = await supabase
    .from('format_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Marks the player's own unread rows read: those of `ids`, or every one (`'all'`). An id of somebody else matches nothing. */
export async function markFormatNotificationsRead(playerId: string, ids: readonly string[] | 'all'): Promise<void> {
  const query = supabase
    .from('format_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('player_id', playerId)
    .is('read_at', null);
  const { error } = await (ids === 'all' ? query : query.in('id', [...ids]));
  if (error) throw error;
}

/** Deletes every notification created before `cutoff`, read or not. Returns how many went. */
export async function purgeFormatNotifications(cutoff: Date): Promise<number> {
  const { count, error } = await supabase
    .from('format_notifications')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff.toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** The names of the leagues `seasonIds`. */
export async function readNotificationLeagueNames(seasonIds: readonly string[]): Promise<Map<string, string>> {
  if (seasonIds.length === 0) return new Map();
  const { data, error } = await supabase.from('seasons').select('id, name').in('id', [...seasonIds]);
  if (error) throw error;
  return new Map(data.map((row) => [row.id, row.name]));
}

/**
 * Who of `playerIds` currently takes part in each of the leagues `seasonIds`: a league participant, or a participant of one of
 * its phases (the roster the player view adds to the league's names). Answered as a set per league.
 */
export async function readCurrentLeagueMembers(
  seasonIds: readonly string[],
  playerIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const members = new Map<string, Set<string>>();
  if (seasonIds.length === 0 || playerIds.length === 0) return members;
  const add = (seasonId: string, playerId: string): void => {
    members.set(seasonId, (members.get(seasonId) ?? new Set<string>()).add(playerId));
  };

  const [league, phases] = await Promise.all([
    readBoundedPages<{ season_id: string; player_id: string }>(
      (from, to) =>
        supabase
          .from('season_participants')
          .select('season_id, player_id')
          .in('season_id', [...seasonIds])
          .in('player_id', [...playerIds])
          .order('season_id')
          .order('player_id')
          .range(from, to),
      { label: 'format-notifications league members' },
    ),
    readBoundedPages<{ player_id: string; tournament_id: string; tournaments: { season_id: string | null } }>(
      (from, to) =>
        supabase
          .from('tournament_participants')
          .select('player_id, tournament_id, tournaments!inner ( season_id )')
          .in('tournaments.season_id', [...seasonIds])
          .in('player_id', [...playerIds])
          .order('tournament_id')
          .order('player_id')
          .range(from, to),
      { label: 'format-notifications phase members' },
    ),
  ]);
  for (const row of league.rows) add(row.season_id, row.player_id);
  for (const row of phases.rows) if (row.tournaments.season_id !== null) add(row.tournaments.season_id, row.player_id);
  return members;
}
