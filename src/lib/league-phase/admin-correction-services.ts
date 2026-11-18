import 'server-only';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import type { PhaseAggregateOwner } from './phase-aggregate-storage';

export async function nativeCorrectionServices(owner: PhaseAggregateOwner) {
  const { createNativePhaseServices } = await import('./services');
  return createNativePhaseServices({
    invalidateMatch: (phase, match) => revalidatePhaseMatchPages(phase, match, phase === owner.phase_id ? owner.season_id : undefined),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: phase => revalidatePhaseMatchPages(phase, undefined, phase === owner.phase_id ? owner.season_id : undefined),
  }).matches;
}
