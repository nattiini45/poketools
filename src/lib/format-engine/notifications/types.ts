/**
 * What the inbox of a kit league sends to a browser. Client-safe. Built only by `toNotificationView`, field by field.
 *
 * Like every player DTO of the format runtime it has no member called `status`, and a player who is no longer a
 * participant of the league is `{ id, name: null }`.
 */
import type { PlayerRef } from '@/lib/format-engine/runtime/view-types';
import type { LText } from '@/lib/studio-core/ltext';

export const NOTIFICATION_KINDS = [
  'rule_notice',
  'challenge_created',
  'challenge_accepted',
  'challenge_declined',
  'challenge_expired',
  'challenge_cancelled',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Which side of the challenge the recipient was on. */
export type ChallengeSide = 'challenger' | 'defender';

interface NotificationBase {
  id: string;
  created_at: string;
  read: boolean;
  league: { id: string; name: string | null };
  /** A same-origin path: the league's play page. */
  href: string;
}

export interface RuleNoticeView extends NotificationBase {
  kind: 'rule_notice';
  message: LText;
}

export interface ChallengeNoticeView extends NotificationBase {
  kind: Exclude<NotificationKind, 'rule_notice'>;
  side: ChallengeSide;
  counterparty: PlayerRef;
}

export type NotificationView = RuleNoticeView | ChallengeNoticeView;

export interface InboxPage {
  items: NotificationView[];
  unread: number;
  /** Where the next page starts, or null on the last one. Counts stored rows: the client must not derive it from `items`. */
  next_offset: number | null;
}

export interface UnreadCount {
  unread: number;
}

/** Rows one page of the inbox holds. */
export const INBOX_PAGE_SIZE = 30;

/** Ids one mark-as-read call may name. */
export const MARK_READ_MAX_IDS = 100;

/** Days a notification is kept, read or not, before the format cron deletes it. */
export const NOTIFICATION_RETENTION_DAYS = 90;
