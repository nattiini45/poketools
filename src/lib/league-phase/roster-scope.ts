import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertFormatPhaseRosterOpen } from '@/lib/format-studio/phase-guards';
import { assertNativePhaseNotArchived } from './admin-locks';
import { rosterOverrideOf } from '@/lib/format-studio/roster-override';
import { legacyPhasePersistence, nativePhasePersistence } from './lifecycle-persistence';
import { requireOpenPhaseRouteMode } from './route-mode';

export async function loadPhaseRosterScope(id: string, requestedPhaseId: string) {
  const mode = await requireOpenPhaseRouteMode();
  const persistence = mode === 'phase' ? nativePhasePersistence : legacyPhasePersistence;
  const seasonId = mode === 'phase' ? id.toLowerCase() : id;
  const phaseId = mode === 'phase' ? requestedPhaseId.toLowerCase() : requestedPhaseId;
  const nativePhase = mode === 'phase' ? await nativePhasePersistence.getById(phaseId) : null;
  const phase = mode === 'phase' ? nativePhase : await legacyPhasePersistence.getById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new UserFacingError('Phase not found in this league', { code: 'PHASE_NOT_FOUND', status: 404 });
  }
  const assertRosterOpen = (body: unknown) => {
    if (nativePhase) assertNativePhaseNotArchived(nativePhase);
    const request = rosterOverrideOf(body);
    return nativePhase
      ? assertFormatPhaseRosterOpen(seasonId, nativePhase, request, nativePhase.format_stage_key !== null)
      : assertFormatPhaseRosterOpen(seasonId, phase, request);
  };
  async function assertRosterSeatsMutable() {
    if (!nativePhase || (nativePhase.bracket_type !== 'single_elim' && nativePhase.bracket_type !== 'double_elim')) return;
    if ((await nativePhasePersistence.rounds(phaseId)).length > 0) {
      throw new UserFacingError('Bracket seat count is fixed after generation — use substitute or regenerate bracket.', {
        code: 'BRACKET_LOCKED_USE_SUBSTITUTE',
      });
    }
  }
  return { mode, phase, phaseId, seasonId, persistence, assertRosterOpen, assertRosterSeatsMutable };
}
