import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { isValidUuid } from '@/lib/utils/uuid';
import { findLegacyPhaseAliasOwner, findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { getPhaseRouteMode } from './route-mode';

export async function resolveIdOnlyMatchRoute(matchId: string) {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy') return { kind: 'legacy' as const };
  if (!isValidUuid(matchId)) return null;

  const target = { matchId };
  if (mode === 'phase') {
    const native = await findNativePhaseAliasOwner(target);
    if (native) return native;
  } else {
    if (await findLegacyPhaseAliasOwner(target) || (mode === 'frozen_phase' && await findNativePhaseAliasOwner(target))) {
      throw new UserFacingError('League phases are temporarily unavailable during maintenance.', {
        code: 'phase_storage_unavailable', status: 503,
      });
    }
  }
  return await standaloneMatchAliasExists(matchId) ? { kind: 'legacy' as const } : null;
}
