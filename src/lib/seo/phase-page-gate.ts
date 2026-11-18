import 'server-only';
import { logger } from '@/lib/logger';
import { isValidUuid } from '@/lib/utils/uuid';

const CANONICAL_PHASE = /^\/leagues\/([^/]+)\/phases\/([^/]+)(?:\/(stats|matches\/([^/]+)))?\/?$/;
const PHASE_ALIAS = /^\/(?:tournaments\/[^/]+(?:\/(?:stats|matches\/[^/]+))?|matches\/[^/]+|admin\/tournaments\/[^/]+\/rounds)\/?$/;

type PhasePageDecision = { kind: 'pass' | 'not_found' | 'unavailable' } | { kind: 'redirect'; href: string };

function decodeId(input: string): string | null {
  try {
    const id = decodeURIComponent(input).toLowerCase();
    return isValidUuid(id) ? id : null;
  } catch {
    return null;
  }
}

export async function phasePageGate(pathname: string, query: URLSearchParams): Promise<PhasePageDecision> {
  const canonical = CANONICAL_PHASE.exec(pathname);
  if (!canonical && !PHASE_ALIAS.test(pathname)) return { kind: 'pass' };
  try {
    if (!canonical) {
      const { parseLegacyPhasePath, nativePhaseRedirect } = await import('@/lib/league-phase/legacy-redirect');
      const alias = parseLegacyPhasePath(pathname);
      if (!alias) return { kind: 'not_found' };
      const { getPhaseRouteMode } = await import('@/lib/league-phase/route-mode');
      const mode = await getPhaseRouteMode();
      if (mode === 'legacy') return { kind: 'pass' };
      if (mode === 'phase') {
        const href = await nativePhaseRedirect(alias, query);
        if (href) return { kind: 'redirect', href };
        const { standaloneTournamentAliasExists } = await import('@/lib/supabase/queries/phase-route-owners');
        return { kind: await standaloneTournamentAliasExists(alias.target) ? 'pass' : 'not_found' };
      }
      const { findNativePhaseAliasOwner, findLegacyPhaseAliasOwner } = await import('@/lib/supabase/queries/phase-route-owners');
      const owner = mode === 'frozen_phase' ? await findNativePhaseAliasOwner(alias.target) : await findLegacyPhaseAliasOwner(alias.target);
      return { kind: owner ? 'unavailable' : 'pass' };
    }

    const seasonId = decodeId(canonical[1]);
    const phaseId = decodeId(canonical[2]);
    const matchId = canonical[4] === undefined ? undefined : decodeId(canonical[4]);
    if (!seasonId || !phaseId || matchId === null) return { kind: 'not_found' };

    const { getPhaseRouteMode } = await import('@/lib/league-phase/route-mode');
    const mode = await getPhaseRouteMode();
    if (mode !== 'legacy' && mode !== 'phase') return { kind: 'unavailable' };
    const { resolveLeaguePhaseRoute, findNativePhaseAliasOwner, findLegacyPhaseAliasOwner } = await import('@/lib/supabase/queries/phase-route-owners');
    const owner = matchId === undefined
      ? await resolveLeaguePhaseRoute(seasonId, phaseId, mode)
      : mode === 'phase'
        ? await findNativePhaseAliasOwner({ phaseId, matchId })
        : await findLegacyPhaseAliasOwner({ phaseId, matchId });
    return { kind: owner?.season_id === seasonId ? 'pass' : 'not_found' };
  } catch (error) {
    logger.error('phase-page-gate', 'Failed to resolve phase page ownership', { pathname, error });
    return { kind: 'unavailable' };
  }
}
