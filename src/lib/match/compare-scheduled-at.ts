/** Minimal shape for scheduled_at sorting — safe for client and server. */
export type ScheduledAtComparable = {
  scheduled_at: string | null;
};

/**
 * Client-side sort mirroring getUpcomingMatches DB order (scheduled_at ASC, nulls last).
 */
export function compareMatchesByScheduledAt(
  a: ScheduledAtComparable,
  b: ScheduledAtComparable,
): number {
  if (a.scheduled_at === null && b.scheduled_at === null) return 0;
  if (a.scheduled_at === null) return 1;
  if (b.scheduled_at === null) return -1;
  return a.scheduled_at.localeCompare(b.scheduled_at);
}
