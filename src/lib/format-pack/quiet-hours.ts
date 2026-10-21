/**
 * Validation of a draft quiet-hours window (`epb.draftClock.quietHours`). Client-safe and pure.
 *
 * One definition serves the pack schema (a pack whose window is invalid fails at load), the draft
 * clock (`src/lib/draft/time.ts`, which re-exports `isValidQuietHours`), the pool-creation route and
 * the snapshot reader. The SQL twin is `draft__cfg_quiet` (supabase/migrations/20261018140100_draft_quiet_hours.sql);
 * the rules below must stay the same as its checks.
 */
import type { QuietHours } from './types';

/**
 * Whether the window is well formed and leaves the pick clock running at least one hour each local day:
 * integer hours, 0 <= startHour < endHour <= 24, at most 23 h long, and a time zone name of 1-64 characters
 * (the SQL twin also checks the name against `pg_timezone_names`; the pack schema adds `isKnownTimeZone`).
 * A 24 h window (0-24) would freeze every pick clock for ever, so it is refused.
 */
export function isValidQuietHours(q: QuietHours): boolean {
  return (
    Number.isInteger(q.startHour) &&
    Number.isInteger(q.endHour) &&
    q.startHour >= 0 &&
    q.startHour <= 23 &&
    q.endHour >= 1 &&
    q.endHour <= 24 &&
    q.startHour < q.endHour &&
    q.endHour - q.startHour <= 23 &&
    typeof q.timeZone === 'string' &&
    q.timeZone.length >= 1 &&
    q.timeZone.length <= 64
  );
}

/**
 * The locale passed to `Intl.DateTimeFormat` when only the time zone is under test. `und` is the
 * BCP 47 "undetermined" tag: nothing is formatted, so no locale is chosen.
 */
const ZONE_PROBE_LOCALE = 'und';

/**
 * Whether `zone` is an IANA time zone this runtime knows (`Intl` throws a RangeError otherwise).
 * Works in Node and browsers. Any other error is unexpected and propagates.
 */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(ZONE_PROBE_LOCALE, { timeZone: zone });
    return true;
  } catch (e) {
    if (e instanceof RangeError) return false;
    throw e;
  }
}
