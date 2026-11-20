import { supabase } from '@/lib/supabase/client';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';

/**
 * Existence checks for the pages whose 404 the proxy decides (`src/lib/seo/page-gate.ts`): a streamed `notFound()`
 * cannot change the 200 status the root `loading.tsx` has committed. Each reads one id column, never the row's
 * contents, and applies the same rule as the page's own read (an enabled share link, a published library entry), in
 * every store the page's own loader reads (`resolveSharedTeam`, `resolveIdOnlyTeamRoute`).
 */

type TeamStore = 'teams' | 'phase_teams';

/** The legacy store alone in the default generation; both stores once the phase store is read (a transfer keeps ids and tokens). */
async function teamStores(): Promise<TeamStore[]> {
  return (await getPhaseRouteMode()) === 'legacy' ? ['teams'] : ['teams', 'phase_teams'];
}

async function anyTeamRow(column: 'share_token' | 'id', value: string, live: 'share_enabled_at' | 'library_published_at'): Promise<boolean> {
  const hits = await Promise.all((await teamStores()).map(async (store) => {
    const { data, error } = await supabase.from(store).select('id').eq(column, value).not(live, 'is', null).maybeSingle();
    if (error) throw error;
    return data !== null;
  }));
  return hits.includes(true);
}

export const shareLinkIsLive = (shareToken: string) => anyTeamRow('share_token', shareToken, 'share_enabled_at');

export const libraryEntryIsPublished = (teamId: string) => anyTeamRow('id', teamId, 'library_published_at');

/**
 * A league or tournament page is public the whole time the row exists, and a deleted one is gone (the recycle bin
 * holds its own copy), so a hit stays valid for a minute in this process: a busy league page costs one id read a
 * minute, not one per view. A miss is never remembered, so a new league answers on the next request. The page still
 * runs its own read and calls `notFound()` for a row deleted inside the minute.
 */
const FOUND_TTL_MS = 60_000;
const FOUND_MAX = 500;
const found = new Map<string, number>();

async function rowExists(table: 'seasons' | 'tournaments', id: string): Promise<boolean> {
  const key = `${table}:${id}`;
  const now = Date.now();
  const until = found.get(key);
  if (until !== undefined && until > now) return true;

  const { data, error } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (data === null) {
    found.delete(key);
    return false;
  }
  if (found.size >= FOUND_MAX) found.delete(found.keys().next().value as string);
  found.set(key, now + FOUND_TTL_MS);
  return true;
}

export const leagueExists = (seasonId: string) => rowExists('seasons', seasonId);
export const tournamentExists = (tournamentId: string) => rowExists('tournaments', tournamentId);