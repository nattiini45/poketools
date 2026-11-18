import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { phaseStorageEnvSchema, readEnv } from '@/lib/env';
import { readPhaseStorageMode, type PhaseStorageMode } from '@/lib/supabase/queries/phase-storage';

export async function getPhaseRouteMode(): Promise<PhaseStorageMode> {
  const { READ_PHASE_STORAGE_STATE } = readEnv(phaseStorageEnvSchema);
  return READ_PHASE_STORAGE_STATE === 'true' ? readPhaseStorageMode() : 'legacy';
}

export async function requireOpenPhaseRouteMode(): Promise<'legacy' | 'phase'> {
  const mode = await getPhaseRouteMode();
  if (mode === 'legacy' || mode === 'phase') return mode;
  throw new UserFacingError('League phases are temporarily unavailable during maintenance.', {
    code: 'phase_storage_unavailable',
    status: 503,
  });
}
