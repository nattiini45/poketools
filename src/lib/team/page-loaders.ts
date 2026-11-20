import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { getTeamById } from '@/lib/supabase/queries/teams';
import { filterTeamForShare, filterLibraryEntryForDisplay } from '@/lib/team/visibility';
import { phaseTeamLibraryEntry, phaseTeamShareView } from '@/lib/team/phase-public-team';
import { resolveSharedTeam } from '@/lib/team/shared-team';
import { resolveIdOnlyTeamRoute } from '@/lib/league-phase/team-route-owner';
import { isRouterPrefetch, parseShareLimitMark, SHARE_LIMIT_HEADER } from '@/lib/seo/share-limit-marker';
import { checkPublicRateLimit } from '@/lib/utils/rate-limit';
import { isValidUuid } from '@/lib/utils/uuid';
import type { SharedTeamView, TeamLibraryEntry } from '@/types/team';

/** A library entry as the page renders it: the owner is never part of it. */
export type LibraryEntryView = Omit<TeamLibraryEntry, 'player_id'>;

export type SharedTeamResult =
  | { status: 'ok'; team: SharedTeamView }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'invalid' }
  | { status: 'not_found' };

export type LibraryEntryResult =
  | { status: 'ok'; entry: LibraryEntryView }
  | { status: 'invalid' }
  | { status: 'not_found' };

/**
 * Same bucket and limit as `GET /api/teams/shared/[token]`, so a client cannot
 * double its allowance by alternating the page and the API. Runs before the
 * token is looked at, like the route.
 *
 * The proxy already charged the request when it passes its verdict in
 * `x-poketools-share-limit` (it deletes a client-sent copy), so the page takes
 * that verdict instead of charging again. Without one (a render the proxy did
 * not gate, or a charge that failed there) the page charges for itself. A router prefetch skips the proxy and renders
 * the page without a verdict; it counts a separate bucket, so warming a link never spends the interactive allowance.
 */
async function sharedTeamRateLimit() {
  const requestHeaders = await headers();
  const charged = parseShareLimitMark(requestHeaders.get(SHARE_LIMIT_HEADER));
  if (charged) {
    return charged.allowed
      ? { allowed: true, remaining: 0, retryAfterSeconds: 0 }
      : { allowed: false, remaining: 0, retryAfterSeconds: charged.retryAfterSeconds };
  }
  if (isRouterPrefetch(requestHeaders)) {
    return checkPublicRateLimit('team-shared-prefetch', { headers: requestHeaders }, { limit: 60, windowSeconds: 60 });
  }
  return checkPublicRateLimit('team-shared', { headers: requestHeaders }, { limit: 60, windowSeconds: 60 });
}

/**
 * One call per render (React `cache()`): `generateMetadata` and the page share
 * the lookup and the single rate-limit hit. A failed read propagates, so a
 * database outage is never reported as a dead link.
 */
export const loadSharedTeam = cache(async (token: string): Promise<SharedTeamResult> => {
  const rate = await sharedTeamRateLimit();
  if (!rate.allowed) return { status: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds };
  // Tokens are UUID v4 (`setTeamShareToken`): anything else cannot match.
  if (!isValidUuid(token)) return { status: 'invalid' };
  // The token names a row in either store (the transfer keeps tokens): each answers through the same allowlist.
  const shared = await resolveSharedTeam(token);
  if (!shared) return { status: 'not_found' };
  return { status: 'ok', team: shared.kind === 'phase' ? phaseTeamShareView(shared.team) : filterTeamForShare(shared.team) };
});

export const loadLibraryEntry = cache(async (id: string): Promise<LibraryEntryResult> => {
  if (!isValidUuid(id)) return { status: 'invalid' };

  // A published native entry resolves like a legacy one, so a library link minted before cutover keeps working.
  const owner = await resolveIdOnlyTeamRoute(id);
  if (owner?.kind === 'phase') {
    if (!owner.team.library_published_at) return { status: 'not_found' };
    const { player_id: _owner, ...view } = phaseTeamLibraryEntry(owner.team);
    return { status: 'ok', entry: view };
  }

  const team = await getTeamById(id);
  if (!team || !team.library_published_at) return { status: 'not_found' };
  const entry = filterLibraryEntryForDisplay({
    id: team.id,
    player_id: team.player_id,
    pokemon: team.pokemon,
    library_title: team.library_title,
    library_description: team.library_description,
    library_tags: team.library_tags,
    library_published_at: team.library_published_at,
    forked_from_team_id: team.forked_from_team_id,
    created_at: team.created_at,
    updated_at: team.updated_at,
  });
  const { player_id: _owner, ...view } = entry;
  return { status: 'ok', entry: view };
});