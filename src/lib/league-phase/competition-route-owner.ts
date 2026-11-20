import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { isValidUuid } from '@/lib/utils/uuid';
import { findLegacyPhaseAliasOwner, findNativePhaseAliasOwner, standaloneTournamentAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import type { CompetitionOwner } from '@/types/competition-owner';
import { getPhaseRouteMode } from './route-mode';

/**
 * Which store holds a competition id (a tournament, or the league phase that replaced it), the way
 * `resolveIdOnlyMatchRoute` answers for a match. The transfer keeps ids, so a page's tournament URL keeps working
 * after cutover and only its reads move.
 *
 * In legacy mode this reads nothing: the mode alone decides.
 */
export type CompetitionRouteOwner = { kind: 'legacy' } | Extract<CompetitionOwner, { kind: 'phase' }>;

export async function resolveIdOnlyCompetitionRoute(
  competitionId: string,
  selectedMode?: Awaited<ReturnType<typeof getPhaseRouteMode>>,
): Promise<CompetitionRouteOwner | null> {
  const mode = selectedMode ?? await getPhaseRouteMode();
  if (mode === 'legacy') return { kind: 'legacy' };
  if (!isValidUuid(competitionId)) return null;

  const target = { phaseId: competitionId };
  if (mode === 'phase') {
    const native = await findNativePhaseAliasOwner(target);
    if (native) return native;
  } else if (await findLegacyPhaseAliasOwner(target) || (mode === 'frozen_phase' && await findNativePhaseAliasOwner(target))) {
    throw new UserFacingError('League phases are temporarily unavailable during maintenance.', {
      code: 'phase_storage_unavailable',
      status: 503,
    });
  }
  return await standaloneTournamentAliasExists(target) ? { kind: 'legacy' } : null;
}
