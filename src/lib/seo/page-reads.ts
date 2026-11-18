import { cache } from 'react';
import { publicReads } from '@/lib/cache/public-reads';
import { phasePublicReads } from '@/lib/cache/phase-public-reads';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { isValidUuid } from '@/lib/utils/uuid';

/**
 * The reads a detail page and its `generateMetadata` share. Next memoises `fetch` only, not Supabase client calls,
 * and `unstable_cache` does not dedupe two concurrent cold calls, so each page and its metadata go through one
 * React `cache()` entry per request: the metadata adds no query to the page's cold-cache budget.
 */
export const readLeague = cache((id: string) => publicReads.season(id));
export const readTournament = cache((id: string) => publicReads.tournament(id));
export const readPlayerProfile = cache((id: string) => publicReads.playerProfile(id));

const readPhase = cache(async (seasonId: string, phaseId: string) => {
  const mode = await requireOpenPhaseRouteMode();
  if (mode === 'phase') {
    const phase = await phasePublicReads.detail(seasonId, phaseId);
    return phase ? { kind: 'phase' as const, phase } : null;
  }
  const tournament = await readTournament(phaseId);
  return tournament?.season_id === seasonId ? { kind: 'legacy-phase' as const, tournament } : null;
});

export function readLeaguePhase(seasonId: string, phaseId: string) {
  if (!isValidUuid(seasonId) || !isValidUuid(phaseId)) return Promise.resolve(null);
  return readPhase(seasonId.toLowerCase(), phaseId.toLowerCase());
}
