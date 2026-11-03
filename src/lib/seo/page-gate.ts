import { isUnknownWikiDetailName } from '@/lib/broadcast/wiki-overlay-lookup';
import { isValidUuid } from '@/lib/utils/uuid';

/**
 * Real 404 statuses for public pages whose subject does not exist. The root `loading.tsx` commits a 200 before a
 * page's `notFound()` runs, so a missing league, species or dead share link would answer 200 with the not-found UI
 * (and `noindex`). The proxy asks this gate first and rewrites to the not-found page with a 404 (`src/proxy.ts`); the
 * pages still call `notFound()` for the rare race where the row changes between the two reads, and for a failed read
 * here.
 *
 * Reads: a team page, a league and a tournament cost one id-only query for a well-formed id (a league or tournament
 * hit is remembered for a minute); the species and wiki names read a generated id list and no database. Every other
 * path reads nothing. A share link is checked only inside its own per-IP allowance (	eam-shared-gate, the numbers of
 * GET /api/teams/shared/[token]): past it the gate reads nothing and the page shows the rate-limited notice, so
 * the gate cannot be used to spend unbounded queries on guessed tokens.
 */

export interface PageLookups {
  shareLinkIsLive(token: string): Promise<boolean>;
  libraryEntryIsPublished(id: string): Promise<boolean>;
  leagueExists(id: string): Promise<boolean>;
  tournamentExists(id: string): Promise<boolean>;
  /** Counts one share-link check against the caller's allowance; false once it is spent. */
  shareLinkCheckAllowed(headers: Headers): Promise<boolean>;
}

const ID_PAGE_PATH = /^\/(teams\/shared|teams\/library|leagues|tournaments)\/([^/]+)\/?$/;

async function databaseLookups(): Promise<PageLookups> {
  // Loaded on demand: only a page that needs a read reaches the database client.
  const [existence, limits] = await Promise.all([
    import('@/lib/supabase/queries/page-existence'),
    import('@/lib/utils/rate-limit'),
  ]);
  return {
    ...existence,
    async shareLinkCheckAllowed(headers) {
      const result = await limits.checkPublicRateLimit('team-shared-gate', { headers }, { limit: 60, windowSeconds: 60 });
      return result.allowed;
    },
  };
}

/**
 * `'not_found'` when `pathname` names a page whose subject is malformed or missing; `null` for every other path and
 * for a page that exists. A failed read answers `null` (and logs the cause): the page decides then.
 */
export async function pageNotFoundGate(
  pathname: string,
  headers: Headers,
  lookups?: PageLookups,
): Promise<'not_found' | null> {
  if (isUnknownWikiDetailName(pathname)) return 'not_found';

  const match = ID_PAGE_PATH.exec(pathname);
  if (!match) return null;

  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return 'not_found';
  }
  if (!isValidUuid(id)) return 'not_found';

  try {
    const reads = lookups ?? (await databaseLookups());
    switch (match[1]) {
      case 'teams/shared':
        if (!(await reads.shareLinkCheckAllowed(headers))) return null;
        return (await reads.shareLinkIsLive(id)) ? null : 'not_found';
      case 'teams/library':
        return (await reads.libraryEntryIsPublished(id)) ? null : 'not_found';
      case 'leagues':
        return (await reads.leagueExists(id)) ? null : 'not_found';
      default:
        return (await reads.tournamentExists(id)) ? null : 'not_found';
    }
  } catch (error) {
    console.error('[page-gate] existence check failed; the page decides:', error);
    return null;
  }
}