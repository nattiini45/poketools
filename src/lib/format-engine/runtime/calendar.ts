/**
 * The calendar of a stage (`Stage.calendar`) as instants. Round n opens at the wall time `time` on the day
 * `start + (n - 1) * every` days (a week is 7 days) in the league's time zone, and closes `round_window_hours` of elapsed
 * time later. A mark fires `offset_hours` of elapsed time after the opening of its round; a deadline policy is due
 * `offset_hours` after the round's deadline. The day arithmetic runs on the wall calendar, so a round still opens at
 * 18:00 local time on both sides of a DST change, while windows and offsets are exact hours.
 *
 * The season row has no time zone column: the league's zone is `LEAGUE_TIME_ZONE` (`@/i18n/config`), the one the draft
 * clock and the quiet hours use. Pure and client-safe.
 */
import { LEAGUE_TIME_ZONE } from '@/i18n/config';
import { zonedWallTimeToUtc } from '@/lib/draft/time';
import type { CalendarMark, DeadlinePolicy, EventSpec, PlayerActionRule, StageCalendar } from '@/lib/format-kit/types';

const HOUR_MS = 3_600_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export interface CalendarClock {
  /** IANA zone the calendar's dates and times are read in; default `LEAGUE_TIME_ZONE`. */
  timeZone?: string;
  /** `seasons.start_date` (YYYY-MM-DD, a longer ISO text is cut to its date); what `start: season_start` means. */
  seasonStart: string | null;
  /**
   * `season_formats.clock_shift_seconds`: the time the league spent in the recycle bin. Every instant the calendar computes
   * moves by it (the stage calendar is made of absolute dates, so a restore has no stored instant to move), which keeps
   * "nothing is due the moment the league comes back" true for marks, action policies and calendar-derived round policies.
   */
  shiftSeconds?: number;
}

interface Day {
  y: number;
  m: number;
  d: number;
}

function parseDay(text: string | null): Day | null {
  const match = text === null ? null : DAY_PATTERN.exec(text);
  if (match === null) return null;
  const day = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  const check = new Date(Date.UTC(day.y, day.m - 1, day.d));
  return check.getUTCFullYear() === day.y && check.getUTCMonth() === day.m - 1 && check.getUTCDate() === day.d ? day : null;
}

function parseTime(text: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(text);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** The instant round `round` of the calendar opens, or null when the calendar cannot be read (no start date, bad text). */
export function roundOpensAt(calendar: StageCalendar, round: number, clock: CalendarClock): Date | null {
  const start = calendar.start.kind === 'date' ? parseDay(calendar.start.date) : parseDay(clock.seasonStart);
  const time = parseTime(calendar.time);
  if (start === null || time === null || !Number.isInteger(round) || round < 1) return null;
  const days = (round - 1) * calendar.every * (calendar.cadence === 'weekly' ? 7 : 1);
  const day = new Date(Date.UTC(start.y, start.m - 1, start.d + days));
  const opens = zonedWallTimeToUtc(
    {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
      hour: time.hour,
      minute: time.minute,
      second: 0,
    },
    clock.timeZone ?? LEAGUE_TIME_ZONE,
  );
  const shift = clock.shiftSeconds ?? 0;
  return opens === null || shift === 0 ? opens : new Date(opens.getTime() + shift * 1000);
}

/** The highest round `calendarRoundAt` answers: the round number the API accepts. */
const MAX_CALENDAR_ROUND = 500;

/**
 * The round the calendar is in at `now`: the number of rounds that have opened (round 1 before the first one does), or
 * null when the calendar cannot be read (no start date, bad text). Round openings only move forward, so this is a binary
 * search over `roundOpensAt`.
 */
export function calendarRoundAt(calendar: StageCalendar, clock: CalendarClock, now: Date): number | null {
  if (roundOpensAt(calendar, 1, clock) === null) return null;
  let low = 1;
  let high = MAX_CALENDAR_ROUND;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const opens = roundOpensAt(calendar, mid, clock);
    if (opens !== null && opens.getTime() <= now.getTime()) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The deadline of round `round`: its opening plus the window. */
export function roundDeadlineAt(calendar: StageCalendar, round: number, clock: CalendarClock): Date | null {
  const opens = roundOpensAt(calendar, round, clock);
  return opens === null ? null : new Date(opens.getTime() + calendar.round_window_hours * HOUR_MS);
}

/** When a mark fires: `offset_hours` after the opening of its round. */
export function markAt(calendar: StageCalendar, mark: CalendarMark, clock: CalendarClock): Date | null {
  const opens = roundOpensAt(calendar, mark.round, clock);
  return opens === null ? null : new Date(opens.getTime() + mark.offset_hours * HOUR_MS);
}

/**
 * The marks whose instant has come, in calendar order: by instant, marks at the same instant in declaration order.
 * Sorted here because the declaration order is the author's (a fork may list `gifts_close` before `gifts_open`), and a
 * cron pass that fires several due marks at once must replay them chronologically: an `open_action` that ran after the
 * `lock_action` of a later mark would reopen a window for good. A calendar that cannot be read has none.
 */
export function dueMarks(calendar: StageCalendar, clock: CalendarClock, now: Date): CalendarMark[] {
  const due: { mark: CalendarMark; at: number; index: number }[] = [];
  calendar.marks.forEach((mark, index) => {
    const at = markAt(calendar, mark, clock);
    if (at !== null && at.getTime() <= now.getTime()) due.push({ mark, at: at.getTime(), index });
  });
  return due.sort((a, b) => a.at - b.at || a.index - b.index).map((entry) => entry.mark);
}

/**
 * When the policy of a round (`match` or `team`) is due: the round's deadline plus the offset. `storedDeadline` (an admin
 * moved `rounds.deadline`, or generation wrote it) wins over the calendar.
 */
export function roundPolicyAt(
  calendar: StageCalendar,
  policy: Pick<DeadlinePolicy, 'offset_hours'>,
  round: number,
  clock: CalendarClock,
  storedDeadline?: string | null,
): Date | null {
  const stored = storedDeadline === undefined || storedDeadline === null ? Number.NaN : Date.parse(storedDeadline);
  const base = Number.isNaN(stored) ? roundDeadlineAt(calendar, round, clock) : new Date(stored);
  return base === null ? null : new Date(base.getTime() + policy.offset_hours * HOUR_MS);
}

/**
 * The instant an action policy is due: the action's closing mark plus the offset (a `time` closing event names a mark of
 * the calendar; a `round_start` one the opening of that round), else the opening of round 1 plus the offset.
 */
export function actionPolicyAt(
  calendar: StageCalendar,
  policy: Pick<DeadlinePolicy, 'offset_hours'>,
  action: Pick<PlayerActionRule, 'window'> | null,
  clock: CalendarClock,
): Date | null {
  const closes: EventSpec | undefined = action?.window.closes_on;
  let anchor: Date | null = null;
  if (closes?.event === 'time') {
    const mark = calendar.marks.find((m) => m.key === closes.mark);
    if (mark !== undefined) anchor = markAt(calendar, mark, clock);
  } else if (closes?.event === 'round_start') {
    anchor = roundOpensAt(calendar, closes.round ?? 1, clock);
  }
  anchor ??= roundOpensAt(calendar, 1, clock);
  return anchor === null ? null : new Date(anchor.getTime() + policy.offset_hours * HOUR_MS);
}

/** The ISO deadline to store on a new round, or null when the stage has no readable calendar. */
export function roundDeadlineIso(calendar: StageCalendar, round: number, clock: CalendarClock): string | null {
  return roundDeadlineAt(calendar, round, clock)?.toISOString() ?? null;
}
