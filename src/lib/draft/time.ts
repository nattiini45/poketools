/**
 * League time helpers (draft-backend §7.7, BR-15; critique S10). Client-safe
 * and pure: the server default (redraft config route) and the FE admin
 * prefill both call `defaultRedraftDeadline`, so the deadline default exists
 * once.
 */
import { LEAGUE_TIME_ZONE } from '@/i18n/config';
import { isValidQuietHours } from '@/lib/format-pack/quiet-hours';
import type { QuietHours } from '@/lib/format-pack/types';

/** The only declaration lives in `@/i18n/config`. */
export { LEAGUE_TIME_ZONE };

/** One definition with the pack schema (`src/lib/format-pack/quiet-hours.ts`); re-exported for the clock's callers. */
export { isValidQuietHours };

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

// ── Quiet hours (pick clock held) ─────────────────────────────────────
//
// TS mirror of the SQL helpers in supabase/migrations/20261018140100_draft_quiet_hours.sql
// (draft__quiet_bounds, draft__quiet_window_end, draft__running_ms, draft__add_running_ms). The server owns every
// deadline; this mirror only drives the display (clock, "held until" label, browser reminders). Shared vectors:
// src/lib/draft/__tests__/fixtures/quiet-hours-vectors.json.
//
// A quiet window is [startHour, endHour) on the local calendar of `timeZone`, once per local day. Bounds are
// instants, so the real length changes on DST days (Europe/Berlin 00-06: 7 h on 2026-10-25, 5 h on 2027-03-28).
// A wall hour that does not exist or exists twice resolves like PostgreSQL's `timestamp AT TIME ZONE`: a
// spring-forward gap takes the offset before the transition, a fall-back overlap the offset after it.

export type { QuietHours };

const HOUR_MS = 3_600_000;
/** Far beyond any pick clock (48 h ladder + extensions at >= 1 running hour per day); hitting it is a bug. */
const MAX_QUIET_STEPS = 1000;
/** Days scanned by `runningMsBetween` before it refuses (a pick clock never spans this long). */
const MAX_SPAN_DAYS = 400;

function assertQuietHours(q: QuietHours): void {
  if (!isValidQuietHours(q)) throw new Error(`invalid quiet hours ${JSON.stringify(q)}`);
}

/** The instant at which `timeZone` shows `hour`:00 on local day (y, m, d); hour 24 = 00:00 of the next day. */
function localHourToUtcMs(y: number, m: number, d: number, hour: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, hour);
  const before = offsetAt(guess - 26 * HOUR_MS, timeZone);
  const after = offsetAt(guess + 26 * HOUR_MS, timeZone);
  if (before === after) return guess - before;
  const viaBefore = guess - before;
  const viaAfter = guess - after;
  const shows = (utc: number) => wallAsUtcMs(wallTimeInZone(new Date(utc), timeZone)) === guess;
  if (shows(viaAfter)) return viaAfter; // regular, or a fall-back overlap (PostgreSQL takes "after")
  if (shows(viaBefore)) return viaBefore;
  return viaBefore; // spring-forward gap: PostgreSQL applies the offset before the transition
}

interface LocalDay {
  y: number;
  m: number;
  d: number;
}

function localDayOf(ms: number, timeZone: string): LocalDay {
  const w = wallTimeInZone(new Date(ms), timeZone);
  return { y: w.year, m: w.month, d: w.day };
}

function addDays(day: LocalDay, n: number): LocalDay {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** The quiet window of one local day as [start, end) epoch ms; null when DST collapses it to nothing. */
function windowOf(day: LocalDay, q: QuietHours): { start: number; end: number } | null {
  const start = localHourToUtcMs(day.y, day.m, day.d, q.startHour, q.timeZone);
  const end = localHourToUtcMs(day.y, day.m, day.d, q.endHour, q.timeZone);
  return end > start ? { start, end } : null;
}

/** End (epoch ms) of the quiet window `atMs` lies in; null outside a window or without quiet hours. */
export function quietWindowEnd(atMs: number, q: QuietHours | null): number | null {
  if (q === null) return null;
  assertQuietHours(q);
  const today = localDayOf(atMs, q.timeZone);
  for (let k = -1; k <= 1; k++) {
    const w = windowOf(addDays(today, k), q);
    if (w && atMs >= w.start && atMs < w.end) return w.end;
  }
  return null;
}

/** The first window start strictly after `atMs`. */
function nextQuietStart(atMs: number, q: QuietHours): number {
  const today = localDayOf(atMs, q.timeZone);
  let best = Number.POSITIVE_INFINITY;
  for (let k = -1; k <= 2; k++) {
    const w = windowOf(addDays(today, k), q);
    if (w && w.start > atMs && w.start < best) best = w.start;
  }
  if (!Number.isFinite(best)) throw new Error('nextQuietStart: no quiet window within two days');
  return best;
}

/** Running (not held) milliseconds in [fromMs, toMs); 0 when `toMs <= fromMs`. Without quiet hours: `to - from`. */
export function runningMsBetween(fromMs: number, toMs: number, q: QuietHours | null): number {
  if (toMs <= fromMs) return 0;
  if (q === null) return toMs - fromMs;
  assertQuietHours(q);
  const first = addDays(localDayOf(fromMs, q.timeZone), -1);
  const last = addDays(localDayOf(toMs, q.timeZone), 1);
  let held = 0;
  for (let i = 0, day = first; ; i++, day = addDays(day, 1)) {
    if (i > MAX_SPAN_DAYS) throw new Error('runningMsBetween: span too long');
    const w = windowOf(day, q);
    if (w) held += Math.max(0, Math.min(w.end, toMs) - Math.max(w.start, fromMs));
    if (day.y === last.y && day.m === last.m && day.d === last.d) break;
  }
  return toMs - fromMs - held;
}

/**
 * The instant at which `ms` running milliseconds have passed since `fromMs`. `ms <= 0` returns `fromMs`. Inside a
 * window the count starts at its end; the result never lies strictly inside a window.
 */
export function addRunningMs(fromMs: number, ms: number, q: QuietHours | null): number {
  if (ms <= 0) return fromMs;
  if (q === null) return fromMs + ms;
  assertQuietHours(q);
  let t = fromMs;
  let rest = ms;
  for (let step = 0; step < MAX_QUIET_STEPS; step++) {
    const end = quietWindowEnd(t, q);
    if (end !== null) t = end;
    const next = nextQuietStart(t, q);
    const available = next - t;
    if (rest <= available) return t + rest;
    rest -= available;
    t = next;
  }
  throw new Error('addRunningMs: no running time found');
}
