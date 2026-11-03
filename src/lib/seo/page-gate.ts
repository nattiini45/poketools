import { isUnknownWikiDetailName } from '@/lib/broadcast/wiki-overlay-lookup';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ShareLimitMark } from './share-limit-marker';

/**
 * Real 404 statuses for public pages whose subject does not exist. The root `loading.tsx` commits a 200 before a
 * page's `notFound()` runs, so a missing league, species or dead share link would answer 200 with the not-found UI
 * (and `noindex`). The proxy asks this gate first and rewrites to the not-found page with a 404 (`src/proxy.ts`); the
 * pages still call `notFound()` for the rare race where the row changes between the two reads, and for a failed read
 * here.
 *
 * Reads: a team page, a league and a tournament cost one id-only query for a well-formed id (a league or tournament
 * hit is remembered for a minute); the species and wiki names read a generated id list and no database. Every other
 * path reads nothing.
 *
 * A share link request spends the common `team-shared` allowance (60 per minute per IP, shared with
 * `GET /api/teams/shared/[token]` and the page) exactly once, here: a malformed or missing link is answered before the
 * page runs, so only the gate can count it. The verdict goes back to the proxy as `shareLimit`, which hands it to the
 * page (`share-limit-marker.ts`) so a live link is not charged twice. Past the allowance the gate reads nothing and the
 * page shows the rate-limited notice, so guessed tokens cannot spend unbounded queries.
 */

export interface PageLookups {
  shareLinkIsLive(token: string): Promise<boolean>;
  libraryEntryIsPublished(id: string): Promise<boolean>;
  leagueExists(id: string): Promise<boolean>;
  tournamentExists(id: string): Promise<boolean>;
  /** Spends one hit of the caller's `team-shared` allowance for this request. */
  chargeShareLink(headers: Headers): Promise<ShareLimitMark>;
}

export interface PageGateResult {
  /** `'not_found'` when the page's subject is malformed or missing. */
  status: 'not_found' | null;
  /** Set when this call charged a share-link request; null when it charged nothing or the charge failed. */
  shareLimit: ShareLimitMark | null;
}

const ID_PAGE_PATH = /^\/(teams\/shared|teams\/library|leagues|tournaments)\/([^/]+)\/?$/;

/** Same bucket, limit and window as `GET /api/teams/shared/[token]` and `loadSharedTeam`. */
export async function chargeShareLinkRequest(headers: Headers): Promise<ShareLimitMark> {
  const limits = await import('@/lib/utils/rate-limit');
  const result = await limits.checkPublicRateLimit('team-shared', { headers }, { limit: 60, windowSeconds: 60 });
  return result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
}

async function databaseLookups(): Promise<PageLookups> {
  // Loaded on demand: only a page that needs a read reaches the database client.
  const existence = await import('@/lib/supabase/queries/page-existence');
  return { ...existence, chargeShareLink: chargeShareLinkRequest };
}

/**
 * Whether `pathname` names a page whose subject is malformed or missing, and what the call charged. A failed read or
 * charge answers `null` status and logs the cause: the page decides (and charges for itself when nothing was charged
 * here).
 */
export async function pageGate(pathname: string, headers: Headers, lookups?: PageLookups): Promise<PageGateResult> {
  if (isUnknownWikiDetailName(pathname)) return { status: 'not_found', shareLimit: null };

  const match = ID_PAGE_PATH.exec(pathname);
  if (!match) return { status: null, shareLimit: null };

  const shared = match[1] === 'teams/shared';
  let id: string | null;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    id = null;
  }
  const wellFormed = id !== null && isValidUuid(id);
  if (!wellFormed && !shared) return { status: 'not_found', shareLimit: null };

  let shareLimit: ShareLimitMark | null = null;
  try {
    const reads = lookups ?? (await databaseLookups());

    if (shared) {
      shareLimit = await reads.chargeShareLink(headers);
      if (!shareLimit.allowed) return { status: null, shareLimit };
      if (!wellFormed) return { status: 'not_found', shareLimit };
    }

    const target = id as string;
    switch (match[1]) {
      case 'teams/shared':
        return { status: (await reads.shareLinkIsLive(target)) ? null : 'not_found', shareLimit };
      case 'teams/library':
        return { status: (await reads.libraryEntryIsPublished(target)) ? null : 'not_found', shareLimit };
      case 'leagues':
        return { status: (await reads.leagueExists(target)) ? null : 'not_found', shareLimit };
      default:
        return { status: (await reads.tournamentExists(target)) ? null : 'not_found', shareLimit };
    }
  } catch (error) {
    console.error('[page-gate] existence check failed; the page decides:', error);
    return { status: wellFormed ? null : 'not_found', shareLimit };
  }
}
