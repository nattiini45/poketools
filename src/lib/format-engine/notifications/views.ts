/**
 * Turns a stored notification into what its recipient may see. Pure: every privacy rule is tested without a database.
 *
 * The same masks as the player views (`runtime/views.ts`): named fields only, and the other player goes through
 * `refOf`, so somebody who no longer takes part in the league is "former player". A rule's notice carries only the text the
 * format's author wrote. A row whose payload cannot be read becomes null: it is a bug to log, not something to show.
 */
import { refOf, type NameMap } from '@/lib/format-engine/runtime/views';
import type { LText } from '@/lib/studio-core/ltext';
import type { Tables } from '@/types/database';
import { NOTIFICATION_KINDS, type ChallengeSide, type NotificationKind, type NotificationView } from './types';

export type StoredNotification = Pick<Tables<'format_notifications'>, 'id' | 'season_id' | 'kind' | 'payload' | 'created_at' | 'read_at'>;

export interface NotificationLookups {
  /** League names by id. */
  leagues: ReadonlyMap<string, string>;
  /** Per league: the public names of its current participants. */
  names: ReadonlyMap<string, NameMap>;
}

const EMPTY_NAMES: NameMap = new Map();

const isKind = (value: string): value is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(value);

const isSide = (value: unknown): value is ChallengeSide => value === 'challenger' || value === 'defender';

function payloadOf(row: StoredNotification): Record<string, unknown> | null {
  const { payload } = row;
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload : null;
}

function isLText(value: unknown): value is LText {
  if (typeof value !== 'object' || value === null) return false;
  const text = value as { base?: unknown; en?: { v?: unknown }; de?: { v?: unknown } };
  const base = text.base === 'en' ? text.en : text.base === 'de' ? text.de : undefined;
  return typeof base?.v === 'string';
}

/** The id of the other player of a challenge notification, or null for any other row. */
export function counterpartyIdOf(row: StoredNotification): string | null {
  const id = payloadOf(row)?.counterparty_id;
  return typeof id === 'string' ? id : null;
}

/** The recipient's view of `row`, or null when its kind or payload cannot be read. */
export function toNotificationView(row: StoredNotification, lookups: NotificationLookups): NotificationView | null {
  const payload = payloadOf(row);
  if (payload === null || !isKind(row.kind)) return null;
  const base = {
    id: row.id,
    created_at: row.created_at,
    read: row.read_at !== null,
    league: { id: row.season_id, name: lookups.leagues.get(row.season_id) ?? null },
    href: `/dashboard/leagues/${encodeURIComponent(row.season_id)}/play`,
  };
  if (row.kind === 'rule_notice') {
    return isLText(payload.message) ? { ...base, kind: row.kind, message: payload.message } : null;
  }
  const counterparty = counterpartyIdOf(row);
  if (counterparty === null || !isSide(payload.role)) return null;
  return {
    ...base,
    kind: row.kind,
    side: payload.role,
    counterparty: refOf(lookups.names.get(row.season_id) ?? EMPTY_NAMES, counterparty),
  };
}
