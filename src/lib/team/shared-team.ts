import 'server-only';
import { getTeamByShareToken } from '@/lib/supabase/queries/teams';
import { resolveNativeTeamShare, type SharedTeamResource } from '@/lib/team/phase-visibility';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';

/**
 * The team a share token names, from the store that holds it. The transfer keeps share tokens, so a link minted before
 * cutover resolves to the native row afterwards.
 *
 * In the default generation this is exactly the legacy read it has always been (one query). Once the phase store is
 * read, both stores are asked, because a token may belong to either while a transfer runs; a token that exists in both
 * is a broken state and `resolveNativeTeamShare` says so rather than picking one.
 */
export async function resolveSharedTeam(token: string): Promise<SharedTeamResource | null> {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') {
    const team = await getTeamByShareToken(token);
    return team ? { kind: 'team', team } : null;
  }
  return resolveNativeTeamShare(token);
}
