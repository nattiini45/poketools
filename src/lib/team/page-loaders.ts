import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { getTeamById, getTeamByShareToken } from '@/lib/supabase/queries/teams';
import { filterTeamForShare, filterLibraryEntryForDisplay } from '@/lib/team/visibility';
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
 */
async function sharedTeamRateLimit() {
  return checkPublicRateLimit('team-shared', { headers: await headers() }, { limit: 60, windowSeconds: 60 });
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
  const team = await getTeamByShareToken(token);
  if (!team) return { status: 'not_found' };
  return { status: 'ok', team: filterTeamForShare(team) };
});

export const loadLibraryEntry = cache(async (id: string): Promise<LibraryEntryResult> => {
  if (!isValidUuid(id)) return { status: 'invalid' };
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