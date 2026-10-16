/**
 * League time helpers (draft-backend §7.7, BR-15; critique S10). Client-safe
 * and pure: the server default (redraft config route) and the FE admin
 * prefill both call `defaultRedraftDeadline`, so the deadline default exists
 * once.
 */
import { LEAGUE_TIME_ZONE } from '@/i18n/config';

/** The only declaration lives in `@/i18n/config`. */
export { LEAGUE_TIME_ZONE };

export interface WallTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Gregorian calendar, Latin digits; the parts are numeric, so the locale is only a carrier. */
const PARTS_LOCALE = 'en-u-ca-gregory-nu-latn';
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat(PARTS_LOCALE, {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock time of `instant` in `timeZone` (whole seconds). */
export function wallTimeInZone(instant: Date, timeZone: string): WallTime {
  const out: WallTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type in out) out[part.type as keyof WallTime] = Number(part.value);
  }
  return out;
}

function wallAsUtcMs(p: WallTime): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Zone offset (ms, wall − UTC) at `utcMs`. */
function offsetAt(utcMs: number, timeZone: string): number {
  const whole = utcMs - (((utcMs % 1000) + 1000) % 1000);
  return wallAsUtcMs(wallTimeInZone(new Date(whole), timeZone)) - whole;
}

/**
 * The UTC instant at which `timeZone` shows wall time `p` (Intl-based,
 * two-pass offset). In a DST gap the result is shifted forward by the gap; in
 * a DST overlap the earlier instant is returned.
 */
export function zonedWallTimeToUtc(p: WallTime, timeZone: string): Date {
  const guess = wallAsUtcMs(p);
  const first = offsetAt(guess, timeZone);
  let utc = guess - first;
  const second = offsetAt(utc, timeZone);
  if (second !== first) utc = guess - second;
  return new Date(utc);
}

const DAY_MS = 86_400_000;

/**
 * The upcoming Sunday 23:59:59 in `timeZone` (default `LEAGUE_TIME_ZONE`) that
 * is strictly later than `now + minLeadMs` (default 0). On a Sunday before
 * 23:59:59 that is the same day (product decision; a lead-time floor is EvoLiga spec
 * question N4 and only needs `minLeadMs`).
 */
export function defaultRedraftDeadline(now: Date, opts: { timeZone?: string; minLeadMs?: number } = {}): Date {
  const timeZone = opts.timeZone ?? LEAGUE_TIME_ZONE;
  const earliest = now.getTime() + Math.max(0, opts.minLeadMs ?? 0);
  const wall = wallTimeInZone(new Date(earliest), timeZone);
  const dayStartUtc = Date.UTC(wall.year, wall.month - 1, wall.day);
  const weekday = new Date(dayStartUtc).getUTCDay(); // 0 = Sunday
  const daysToSunday = (7 - weekday) % 7;

  for (let week = 0; week < 3; week++) {
    const sunday = new Date(dayStartUtc + (daysToSunday + 7 * week) * DAY_MS);
    const candidate = zonedWallTimeToUtc(
      {
        year: sunday.getUTCFullYear(),
        month: sunday.getUTCMonth() + 1,
        day: sunday.getUTCDate(),
        hour: 23,
        minute: 59,
        second: 59,
      },
      timeZone,
    );
    if (candidate.getTime() > earliest) return candidate;
  }
  // Unreachable: a Sunday 23:59:59 at most 14 days later is always after `earliest`.
  throw new Error('defaultRedraftDeadline: no Sunday found');
}
