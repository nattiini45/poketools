/**
 * Date windows of the admin match list. The calendar math (today, next 7
 * days, a custom from/to day) runs in the VIEWER's time zone, so "today" is
 * the viewer's local day, not the server's. The URL keeps a relative token
 * (`range=today`) or local `YYYY-MM-DD` days; the API receives the resolved
 * instants with an offset (`date_from` inclusive, `date_to` exclusive).
 *
 * Pure and client-safe. Day offsets are calendar arithmetic on the local
 * wall date (`Date.UTC(y, m, d + k)`), never `+ 24 h`, so a DST day (23 or 25
 * hours) is still one day.
 */
import { wallTimeInZone, zonedWallTimeToUtc } from '@/lib/draft/time';
import type { MatchListUrlState } from '@/lib/admin/match-list';

export interface MatchListClock {
  /** IANA zone of the viewer. */
  timeZone: string;
  /** "Now" in epoch ms. */
  nowMs: number;
}

/** ISO instants (`toISOString()`); `none` = "the field is not set". */
export interface MatchListDateWindow {
  /** Inclusive. */
  from?: string;
  /** Exclusive. */
  to?: string;
  none?: boolean;
}

/** 00:00 of the local day `y-m-d` (+ `dayOffset` calendar days) in `timeZone`. */
function midnightOf(y: number, m: number, d: number, dayOffset: number, timeZone: string): Date {
  const day = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return zonedWallTimeToUtc(
    {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

/** 00:00 of today + `dayOffset` days in `timeZone` (DST safe). */
export function startOfZonedDay(nowMs: number, timeZone: string, dayOffset = 0): Date {
  const today = wallTimeInZone(new Date(nowMs), timeZone);
  return midnightOf(today.year, today.month, today.day, dayOffset, timeZone);
}

const LOCAL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` as numbers; null when it is not a real calendar day. */
function parseLocalDay(value: string): { y: number; m: number; d: number } | null {
  const match = LOCAL_DAY.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * The instants a date selection stands for. `null` = no date filter; `range`
 * wins over `from` / `to`; a custom `to` day is inclusive in the URL, so it
 * becomes the start of the FOLLOWING local day (exclusive upper bound).
 *
 * - today: [start of today, start of tomorrow)
 * - next7: [start of today, start of today + 7 days)
 * - last7: [start of today - 6 days, start of tomorrow)
 * - none: `{ none: true }`
 */
export function resolveMatchListDateWindow(
  state: Pick<MatchListUrlState, 'range' | 'from' | 'to'>,
  clock: MatchListClock,
): MatchListDateWindow | null {
  const { timeZone, nowMs } = clock;
  const iso = (dayOffset: number) => startOfZonedDay(nowMs, timeZone, dayOffset).toISOString();

  switch (state.range) {
    case 'none':
      return { none: true };
    case 'today':
      return { from: iso(0), to: iso(1) };
    case 'next7':
      return { from: iso(0), to: iso(7) };
    case 'last7':
      return { from: iso(-6), to: iso(1) };
    default:
      break;
  }

  const from = parseLocalDay(state.from);
  const to = parseLocalDay(state.to);
  if (!from && !to) return null;
  const window: MatchListDateWindow = {};
  if (from) window.from = midnightOf(from.y, from.m, from.d, 0, timeZone).toISOString();
  if (to) window.to = midnightOf(to.y, to.m, to.d, 1, timeZone).toISOString();
  return window;
}
