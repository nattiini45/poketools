/**
 * The canonical chronological order of completed matches for every rating
 * and streak replay (the rating rebuild, reconcile and the gamification
 * backfill).
 *
 * Primary key: `date_played ?? created_at`, oldest first. Ties reproduce the
 * order the rating replay has always used (the replay reader returns
 * `date_played` desc nulls last, `created_at` desc, `id` desc, and the replay
 * then applies a stable ascending sort by the primary key):
 *   1. a dated match before an undated one,
 *   2. then `created_at`, newest first,
 *   3. then `id`, descending (lowercase uuid text compares like the uuid bytes).
 *
 * Timestamps compare at microsecond precision, the precision Postgres stores
 * and the reader orders by: two `created_at` values inside one millisecond
 * keep the reader's order instead of falling through to `id`.
 *
 * The order is total, so any two callers that sort the same matches with it
 * see the same sequence, and the order restricted to one player's matches is
 * that player's rating-curve order.
 */
export interface ReplayOrderMatch {
  id: string;
  date_played: string | null;
  created_at: string;
}

const FRACTIONAL_SECONDS = /[T ]\d{2}:\d{2}:\d{2}\.(\d+)/;

/**
 * Compare two timestamps at microsecond precision. `Date` keeps milliseconds
 * only, so the sub-millisecond digits (positions 4-6 of the fraction, as
 * PostgREST serialises `timestamptz`) break a millisecond tie.
 */
function compareTime(a: string, b: string): number {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  if (ms !== 0) return ms;
  return subMillisecondMicros(a) - subMillisecondMicros(b);
}

function subMillisecondMicros(value: string): number {
  const fraction = FRACTIONAL_SECONDS.exec(value)?.[1] ?? '';
  return Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function compareReplayOrder(a: ReplayOrderMatch, b: ReplayOrderMatch): number {
  const primary = compareTime(a.date_played ?? a.created_at, b.date_played ?? b.created_at);
  if (primary !== 0) return primary;
  const aDated = a.date_played !== null;
  const bDated = b.date_played !== null;
  if (aDated !== bDated) return aDated ? -1 : 1;
  const created = compareTime(b.created_at, a.created_at);
  if (created !== 0) return created;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}
