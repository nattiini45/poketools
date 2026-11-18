import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { AuthError } from '@/lib/auth/helpers';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import type { SessionPlayer } from '@/types/auth';

export type PhaseParams = { id: string; phaseId: string };
export type RoundParams = PhaseParams & { rid: string };

export function invalidPhaseRoundPath({ id, phaseId, rid }: PhaseParams & { rid?: string }) {
  return rejectInvalidPathId(id, 'INVALID_SEASON_ID')
    ?? rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID')
    ?? (rid === undefined ? null : rejectInvalidPathId(rid, 'INVALID_ROUND_ID'));
}

export async function loadRoundPhase({ id, phaseId }: PhaseParams, actor?: SessionPlayer) {
  if (await requireOpenPhaseRouteMode() !== 'phase') {
    throw new UserFacingError('Phase not found', { code: 'PHASE_NOT_FOUND', status: 404 });
  }
  const season = await getSeasonById(id.toLowerCase());
  if (!season) throw new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
  const phase = await getPhaseById(phaseId.toLowerCase());
  if (!phase || phase.season_id !== season.id) {
    throw new UserFacingError('Phase not found', { code: 'PHASE_NOT_FOUND', status: 404 });
  }
  if (actor && !await canAdministerPhaseAccess(actor, phase.id)) {
    throw new AuthError('Admin access required for this resource', 403, 'forbidden');
  }
  return { season, phase };
}

export async function loadOwnedRound(phaseId: string, roundId: string) {
  const round = await getPhaseRoundById(roundId.toLowerCase(), phaseId);
  if (!round || round.phase_id !== phaseId) {
    throw new UserFacingError('Round not found', { code: 'round_not_found', status: 404 });
  }
  return round;
}

export function phaseRoundError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P0001'
    && 'message' in error && error.message === 'phase_storage_not_ready') {
    const refusal = new UserFacingError('League phases are temporarily unavailable during maintenance.', {
      code: 'phase_storage_unavailable', status: 503,
    });
    return safeErrorResponse(Object.assign(refusal, { cause: error }), fallback);
  }
  return safeErrorResponse(error, fallback);
}
