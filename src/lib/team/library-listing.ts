import 'server-only';
import { listLibraryHead, listLibraryTeams } from '@/lib/supabase/queries/teams';
import { listPhaseLibraryHead } from '@/lib/supabase/queries/phase-teams';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { phaseTeamLibraryEntry } from './phase-public-team';
import type { TeamLibraryEntry, TeamLibraryListParams } from '@/types/team';

/**
 * One page of the published team library, from the store or stores that hold it.
 *
 * In the default generation this is exactly the legacy listing (one read). Once the phase store is read, a page of the
 * merged listing is answered exactly rather than approximately: each store is asked for its first `offset + limit`
 * entries (in the same order: `library_published_at` descending, then the unique `id`) with its exact count, and the
 * two heads are merged and sliced. That keeps every offset correct, including one that points into the second half of
 * the list, and makes `total` the sum of both counts.
 *
 * The cost of a deep offset follows from the same rule: it is `2 * (offset + limit)` rows read, in `.range()` pages, so
 * a page far down the list costs proportionally more than the first one. A caller that pages from the top (the UI does)
 * pays two head reads of `offset + limit` rows each.
 */
export async function listLibraryPage(params: TeamLibraryListParams = {}): Promise<{ data: TeamLibraryEntry[]; total: number }> {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') return listLibraryTeams(params);

  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const offset = Math.max(0, params.offset ?? 0);
  const take = offset + limit;

  const [legacy, phase] = await Promise.all([
    listLibraryHead(take, params),
    listPhaseLibraryHead(take, params),
  ]);

  const merged = [...legacy.data, ...phase.rows.map(phaseTeamLibraryEntry)].sort(comparePublished);
  return { data: merged.slice(offset, offset + limit), total: legacy.total + phase.total };
}

/** Newest publication first, then the id: the order both stores read in, so the merge is stable and total. */
function comparePublished(a: TeamLibraryEntry, b: TeamLibraryEntry): number {
  if (a.library_published_at !== b.library_published_at) {
    return a.library_published_at < b.library_published_at ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
