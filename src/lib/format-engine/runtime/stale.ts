/**
 * The signal of a write that was planned from an older version of the league's format: the database raised
 * `format_context_stale` (`FormatRuntimeError`) because `season_formats.revision` moved after the context was loaded.
 * Nothing was written and no event key was used up, so a background caller (a hook, the cron pass) treats it as "retry
 * later" and an admin's request answers 409.
 *
 * Matched by the error's `code` so that this module needs no import of the query module (which hooks and the cron mock
 * and load lazily).
 */
export function isFormatContextStale(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'format_context_stale';
}

/**
 * Why a hook resolved false, for a caller that tells "retry later" from a failure (the cron backfill and revert heal): a
 * hook sets `stale` when a step was refused with `format_context_stale` (the format changed after the hook loaded it:
 * nothing was written and no key was used up) and `failed` for every other reason. A call that resolves true sets neither.
 * Optional on every hook input; a caller that only needs the boolean passes none.
 */
export interface HookReport {
  stale: boolean;
  failed: boolean;
}

/** A report with nothing set. */
export function newHookReport(): HookReport {
  return { stale: false, failed: false };
}

/** True when a hook resolved false only because the format changed meanwhile: not a failure, retried by the next pass. */
export function isStaleOnly(report: HookReport): boolean {
  return report.stale && !report.failed;
}
