import 'server-only';
/**
 * What each recent version of a ruleset changed against the one before it, for the version list of the read-only page.
 *
 * The comparison is between the two FROZEN resolved rules (`summarizeChange`, the same one the pin card uses), never the
 * documents: a version that only picked up corrected catalog data differs although its document does not. Only the newest
 * `VERSION_CHANGE_LIMIT` versions are compared (their rules are read in one query); older rows get no entry.
 */
import { listVersionRules } from '@/lib/supabase/queries/ruleset-definitions';
import type { RulesetVersionSummary } from './library-types';
import { summarizeChange, type PinChangeSummary } from './pin-info';

/** Versions compared, newest first. Each needs its resolved rules (up to 256 KB), so the list stays short. */
export const VERSION_CHANGE_LIMIT = 10;

/**
 * Per version number, the change against the previous version: `null` for version 1 (nothing before it). A version whose
 * predecessor is not in the list, or is older than the compared window, has no entry.
 */
export async function getVersionChanges(
  definitionId: string,
  versions: readonly Pick<RulesetVersionSummary, 'version_no'>[],
): Promise<Map<number, PinChangeSummary | null>> {
  const newest = [...versions].sort((x, y) => y.version_no - x.version_no).slice(0, VERSION_CHANGE_LIMIT);
  const numbers = new Set(versions.map((v) => v.version_no));
  // The window plus the version before its oldest member, so every compared version has a predecessor to read.
  const wanted = new Set<number>(newest.map((v) => v.version_no));
  for (const v of newest) {
    const before = previousOf(v.version_no, numbers);
    if (before !== null) wanted.add(before);
  }
  const rules = await listVersionRules(definitionId, [...wanted]);

  const changes = new Map<number, PinChangeSummary | null>();
  for (const v of newest) {
    const before = previousOf(v.version_no, numbers);
    if (before === null) {
      changes.set(v.version_no, null);
      continue;
    }
    const from = rules.get(before);
    const to = rules.get(v.version_no);
    if (from !== undefined && to !== undefined) changes.set(v.version_no, summarizeChange(from, to));
  }
  return changes;
}

/** The highest version number below `versionNo` that exists, or null for the first one. */
function previousOf(versionNo: number, existing: ReadonlySet<number>): number | null {
  let best: number | null = null;
  for (const n of existing) if (n < versionNo && (best === null || n > best)) best = n;
  return best;
}
