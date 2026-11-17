import 'server-only';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import { releasePhaseTeamsFromMatches } from '@/lib/supabase/queries/phase-teams';
import { createPhaseTeamServices } from '@/lib/team/phase-services';
import { createNativePhaseWikiServices } from '@/lib/wiki/native-phase-services';
import { bindPhaseReportTrigger } from '@/lib/ai/phase-trigger';
import { createPhaseMatchServices, type PhaseMatchServiceEffects } from './match-services';
import { createNativePhaseEnrollment } from './enrollment-services';
import { createNativePhaseTeamAudit } from './team-audit';
import { loadPhaseReportStandings } from './report-standings';
import { announcePhaseMatchCompletion, announcePhaseMatchDispute, announceNativeKitStageCompletion } from './announcements';
import { createPhaseReportPublisher } from './report-publication';

export interface NativePhaseInvalidation {
  invalidateMatch: PhaseMatchServiceEffects['revalidate'];
  invalidateSeason(seasonId: string, phaseIds: readonly string[]): void;
  invalidateWiki(phaseId: string): Promise<void>;
}

export function createNativePhaseServices(invalidation: NativePhaseInvalidation) {
  for (const key of ['invalidateMatch', 'invalidateSeason', 'invalidateWiki'] as const) {
    if (typeof invalidation?.[key] !== 'function') throw new Error(`Native phase services require ${key}`);
  }
  const enrollment = createNativePhaseEnrollment();
  const matches = createPhaseMatchServices({
    canAdminister: (player, phaseId) => canAdministerPhaseAccess(player, phaseId),
    releaseTeams: matchId => releasePhaseTeamsFromMatches([matchId]),
    announcements: announcePhaseMatchCompletion,
    announceDispute: announcePhaseMatchDispute,
    revalidate: (...args) => invalidation.invalidateMatch(...args),
    kit: {
      enroll: enrollment.enroll,
      auditMatchTeams: async (input, generation, context) => {
        const audit = createNativePhaseTeamAudit(seasonId => invalidation.invalidateSeason(seasonId, [input.phase.id]));
        await audit({ ...input, generation, context, retry: input.auditRetry });
      },
      stageCompleted: announceNativeKitStageCompletion,
      invalidate: (...args) => invalidation.invalidateSeason(...args),
    },
  });
  return {
    matches, enrollment,
    teams: createPhaseTeamServices(),
    wiki: createNativePhaseWikiServices(phaseId => invalidation.invalidateWiki(phaseId)),
    triggerReport: bindPhaseReportTrigger(loadPhaseReportStandings,
      createPhaseReportPublisher((...args) => invalidation.invalidateSeason(...args))),
  };
}
