/**
 * Screen-reader announcements for the pick screen (draft-frontend §5.9),
 * derived from two consecutive view models. Pure, so the diff is unit-tested.
 *
 * - Polite: every new pick ("{player} drafted {line}.") and, when the clock
 *   moves to someone else, "{player} is on the clock.". One poll can carry
 *   several of them (a pick always moves the clock), so they are all kept and
 *   read as one sentence sequence; none is dropped.
 * - Assertive: "You are on the clock." when the clock moves to the viewer,
 *   and "Draft paused." / "Draft resumed.". The newest one wins.
 *
 * State holds announcement kinds and data, never text; the text is built at
 * render time in the current UI language (i18n-core §1.7).
 */
import type { Locale } from '@/i18n/config';
import type { Translator } from '@/i18n/core';
import type { DraftScreenEn } from '@/i18n/messages/draft/screen';
import type { timeMessages } from '@/i18n/messages/time';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/lib/draft-ui/snapshot-types';

/**
 * A line as the toast and the announcer name it: base and final stage (canonical names). `unknown` marks a
 * line missing from the catalog: `base` then holds the raw line id, which is never shown as a name (the
 * announcer says "{player} made a pick.").
 */
export interface AnnouncedLine {
  base: string;
  stage3: string | null;
  unknown?: true;
}

export type Announcement =
  | { kind: 'picked'; player: string; line: AnnouncedLine }
  | { kind: 'onClock'; player: string }
  | { kind: 'yourTurn' }
  | { kind: 'paused' }
  | { kind: 'resumed' }
  | { kind: 'oneMinute' }
  | { kind: 'oneHour' };

export interface AnnouncementDiff {
  /** In reading order: the picks (by pick number), then who is on the clock. */
  polite: Announcement[];
  /** The newest assertive announcement, or null. */
  assertive: Announcement | null;
  /** The clock just moved to the viewer (drives the in-app "your turn" toast). */
  yourTurn: boolean;
}

export function announcedLine(entry: DraftLineCatalogEntry | undefined, lineId: LineId): AnnouncedLine {
  return entry ? { base: entry.stages[0].name, stage3: entry.stages[2]?.name ?? null } : { base: lineId, stage3: null, unknown: true };
}

/** What changed between two view models, as announcements. */
export function diffAnnouncements(
  prev: DraftViewModel,
  next: DraftViewModel,
  entryOf: (id: LineId) => DraftLineCatalogEntry | undefined,
): AnnouncementDiff {
  const polite: Announcement[] = [];
  const assertive: Announcement[] = [];
  const known = new Set(prev.picks.map((p) => p.pick_id));
  const added = next.picks.filter((p) => !known.has(p.pick_id)).sort((a, b) => a.pick_number - b.pick_number);
  for (const p of added) polite.push({ kind: 'picked', player: p.playerName, line: announcedLine(entryOf(p.line_id), p.line_id) });
  if (prev.paused !== next.paused) assertive.push({ kind: next.paused ? 'paused' : 'resumed' });
  const slotChanged = prev.activeSlot?.slot_id !== next.activeSlot?.slot_id;
  if (slotChanged && next.activeSlot && next.status === 'in_progress') {
    if (next.activeSlot.isViewer) assertive.push({ kind: 'yourTurn' });
    else polite.push({ kind: 'onClock', player: next.activeSlot.playerName });
  }
  return { polite, assertive: assertive.at(-1) ?? null, yourTurn: slotChanged && next.viewerOnClock };
}

export interface AnnouncementTextDeps {
  t: Translator<DraftScreenEn>;
  tTime: Translator<(typeof timeMessages)['en']>;
  names: NameResolver;
  dl: Locale;
}

export function announcementText(a: Announcement, d: AnnouncementTextDeps): string {
  switch (a.kind) {
    case 'picked':
      if (a.line.unknown) return d.t('announce.pickedUnknown', { player: a.player });
      return d.t('announce.picked', { player: a.player, line: d.names.lineLabel(a.line.base, a.line.stage3, d.dl) });
    case 'onClock':
      return d.t('announce.onClock', { player: a.player });
    case 'yourTurn':
      return d.t('announce.yourTurn');
    case 'paused':
      return d.t('announce.paused');
    case 'resumed':
      return d.t('announce.resumed');
    case 'oneMinute':
      return d.tTime('minutesLeft', { count: 1 });
    case 'oneHour':
      return d.tTime('hoursLeft', { count: 1 });
  }
}

/** All announcements of one update as one string: each is a full sentence, so a space joins them. */
export function announcementsText(list: readonly Announcement[], d: AnnouncementTextDeps): string {
  return list.map((a) => announcementText(a, d)).join(' ');
}
