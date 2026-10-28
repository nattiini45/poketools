/**
 * The notification text a push carries (docs/push.md, "Payload"). Server only: it is built here, in the
 * language stored with the subscription (`push_subscriptions.locale`), so the service worker only shows it.
 *
 * The payload is small JSON `{ kind, title, body, url, tag }`: league name, a duration and a same-origin path.
 * No player id, no token, no pick data, no secrets. `tag` is `draft-<poolId>`: a newer alert for the same pool
 * replaces the older one in the notification tray (the service worker shows it with `renotify`).
 */
import 'server-only';

import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { pushMessages } from '@/i18n/messages/push';
import type { ReminderThreshold } from '@/lib/draft/notify';

export type PushKind = 'turn_started' | 'turn_reminder' | 'redraft_published';

export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  /** Same-origin path the click opens. */
  url: string;
  tag: string;
}

/** Most characters of a title or body: a league name is free text and the whole payload must stay small. */
const MAX_TITLE = 120;
const MAX_BODY = 240;

const THRESHOLD_SECONDS: Record<ReminderThreshold, number> = { '8h': 8 * 3600, '4h': 4 * 3600, '1h': 3600 };

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** "12 h", "1 h 30 min", "2 d 4 h", "45 min": whole units, at least one minute. */
export function formatPushDuration(seconds: number, locale: Locale): string {
  const t = createTranslator(pushMessages, locale);
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (days > 0) return hours > 0 ? t('alert.duration.daysHours', { d: days, h: hours }) : t('alert.duration.days', { d: days });
  if (hours > 0) return minutes > 0 ? t('alert.duration.hoursMinutes', { h: hours, m: minutes }) : t('alert.duration.hours', { h: hours });
  return t('alert.duration.minutes', { m: Math.max(1, minutes) });
}

export function draftRoomUrl(seasonId: string, poolId: string): string {
  return `/leagues/${encodeURIComponent(seasonId)}/draft-room?pool=${encodeURIComponent(poolId)}`;
}

export const draftPushTag = (poolId: string): string => `draft-${poolId}`;

interface TurnPayloadInput {
  kind: 'turn_started' | 'turn_reminder';
  leagueName: string;
  seasonId: string;
  poolId: string;
  /** The slot's full pick time (turn_started). */
  timerSeconds: number;
  /** Which reminder fired (turn_reminder). */
  threshold?: ReminderThreshold;
}

/** The turn alert or reminder for one subscription language. */
export function turnPayload(input: TurnPayloadInput, locale: Locale): PushPayload {
  const t = createTranslator(pushMessages, locale);
  const league = input.leagueName.trim();
  const title = league ? t('alert.turnTitle', { league }) : t('alert.turnTitleNoLeague');
  const body =
    input.kind === 'turn_reminder' && input.threshold
      ? t('alert.remindBody', { time: formatPushDuration(THRESHOLD_SECONDS[input.threshold], locale) })
      : t('alert.turnBody', { time: formatPushDuration(input.timerSeconds, locale) });
  return {
    kind: input.kind,
    title: clip(title, MAX_TITLE),
    body: clip(body, MAX_BODY),
    url: draftRoomUrl(input.seasonId, input.poolId),
    tag: draftPushTag(input.poolId),
  };
}

/** The "redraft results are out" alert for one subscription language. */
export function redraftPayload(
  input: { leagueName: string; seasonId: string; poolId: string },
  locale: Locale,
): PushPayload {
  const t = createTranslator(pushMessages, locale);
  const league = input.leagueName.trim();
  return {
    kind: 'redraft_published',
    title: clip(league ? t('alert.redraftTitle', { league }) : t('alert.redraftTitleNoLeague'), MAX_TITLE),
    body: clip(t('alert.redraftBody'), MAX_BODY),
    url: draftRoomUrl(input.seasonId, input.poolId),
    tag: draftPushTag(input.poolId),
  };
}
