/**
 * The inbox page of a player: their rows, the unread count, and what the masks need, in a fixed number of reads whatever the
 * page holds (one for the rows, one for the count, one for the league names, two for who still takes part, one for the
 * names). Server only.
 */
import 'server-only';

import { logger } from '@/lib/logger';
import {
  countUnreadFormatNotifications,
  listFormatNotifications,
  readCurrentLeagueMembers,
  readNotificationLeagueNames,
} from '@/lib/supabase/queries/format-notifications';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import type { InboxPage, NotificationView } from './types';
import { counterpartyIdOf, toNotificationView } from './views';

const TAG = 'format-engine/notifications';

/** Per league, the public names of the people in `members` who have one. */
async function namesByLeague(members: ReadonlyMap<string, ReadonlySet<string>>): Promise<Map<string, Map<string, string>>> {
  const known = await resolvePlayerNames([...new Set([...members.values()].flatMap((set) => [...set]))]);
  const out = new Map<string, Map<string, string>>();
  for (const [seasonId, set] of members) {
    out.set(seasonId, new Map([...set].flatMap((id): [string, string][] => (known[id] === undefined ? [] : [[id, known[id]]]))));
  }
  return out;
}

export async function loadInboxPage(playerId: string, limit: number, offset: number): Promise<InboxPage> {
  const [{ rows, hasMore }, unread] = await Promise.all([
    listFormatNotifications(playerId, limit, offset),
    countUnreadFormatNotifications(playerId),
  ]);
  const seasonIds = [...new Set(rows.map((row) => row.season_id))];
  const counterparties = [...new Set(rows.flatMap((row) => counterpartyIdOf(row) ?? []))];
  const [leagues, members] = await Promise.all([readNotificationLeagueNames(seasonIds), readCurrentLeagueMembers(seasonIds, counterparties)]);
  const names = await namesByLeague(members);

  const items: NotificationView[] = [];
  for (const row of rows) {
    const view = toNotificationView(row, { leagues, names });
    if (view === null) logger.error(TAG, 'a stored notification cannot be read', { notificationId: row.id, kind: row.kind });
    else items.push(view);
  }
  return { items, unread, next_offset: hasMore ? offset + rows.length : null };
}
