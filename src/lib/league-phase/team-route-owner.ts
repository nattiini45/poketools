import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { isValidUuid } from '@/lib/utils/uuid';
import { getPhaseTeamById } from '@/lib/supabase/queries/phase-teams';
import type { PhaseTeam } from '@/types/phase-team';
import { getPhaseRouteMode } from './route-mode';

/**
 * Which store holds a team id, the way `resolveIdOnlyMatchRoute` answers for a match.
 *
 * - `legacy`: no native phase team holds the id, so the caller runs the legacy path untouched (its own
 *   not-found answer included).
 * - `phase`: a native phase team; the caller reads and writes it through the phase services.
 *
 * In legacy mode this reads nothing: the mode alone decides, so the legacy route keeps its exact request
 * and response behaviour. While the storage is frozen mid-transfer, an id a native row holds answers 503
 * rather than being written into a store the transfer is moving; a standalone team keeps the legacy path.
 */
export type TeamRouteOwner = { kind: 'legacy' } | { kind: 'phase'; team: PhaseTeam };

export async function resolveIdOnlyTeamRoute(
  teamId: string,
  selectedMode?: Awaited<ReturnType<typeof getPhaseRouteMode>>,
): Promise<TeamRouteOwner | null> {
  const mode = selectedMode ?? await getPhaseRouteMode();
  if (mode === 'legacy') return { kind: 'legacy' };
  if (!isValidUuid(teamId)) return null;

  const native = await getPhaseTeamById(teamId);
  if (!native) return { kind: 'legacy' };
  if (mode === 'phase') return { kind: 'phase', team: native };
  throw new UserFacingError('League phases are temporarily unavailable during maintenance.', {
    code: 'phase_storage_unavailable',
    status: 503,
  });
}
