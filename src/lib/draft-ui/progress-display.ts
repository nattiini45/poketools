/**
 * Progress display helpers. Thin wrappers
 * over DC-0's `src/lib/draft/progress-sources.ts`, which stays the only
 * mapping of tracker columns to the spec's sources. Pure and client-safe.
 *
 * Rule (§8.3): the number labelled KOs is `displayKills(t)` (= `real_kills`)
 * only; the total is "progress" and renders with `ProgressSourceChips`.
 */
import { progressSourcesOf, totalEligibleProgress, type ProgressSources } from '@/lib/draft/progress-sources';

export type { ProgressSources } from '@/lib/draft/progress-sources';
export { displayKills, PROGRESS_SOURCE_ORDER } from '@/lib/draft/progress-sources';

export type TrackerLike = Parameters<typeof progressSourcesOf>[0] & { current_stage: number; total_kos: number };

/** The five sources plus their total (= `tracker.total_kos`). */
export function breakdown(t: TrackerLike): ProgressSources & { totalProgress: number } {
  const sources = progressSourcesOf(t);
  return { ...sources, totalProgress: totalEligibleProgress(sources) };
}

/** Display order of trackers: stage desc, then self-earned KOs desc, then total progress desc. */
export function compareTrackersForDisplay(a: TrackerLike, b: TrackerLike): number {
  const sa = breakdown(a);
  const sb = breakdown(b);
  return (
    b.current_stage - a.current_stage ||
    sb.selfEarnedKills - sa.selfEarnedKills ||
    sb.totalProgress - sa.totalProgress
  );
}
