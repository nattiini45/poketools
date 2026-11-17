import 'server-only';
import { requireAuth, isSuperadmin, AuthError } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { phaseWikiStorage } from '@/lib/supabase/queries/phase-wiki-notes';
import { createPhaseWikiServices } from './phase-services';
import seasonErrors from '@/i18n/messages/errors/seasons/en';

async function assertPhase(phaseId: string): Promise<void> {
  if (!await getPhaseById(phaseId)) {
    throw new UserFacingError(seasonErrors.PHASE_NOT_FOUND, { status: 404, code: 'PHASE_NOT_FOUND' });
  }
}

export function createNativePhaseWikiServices(invalidate: (phaseId: string) => Promise<void>) {
  return createPhaseWikiServices({
    storage: phaseWikiStorage,
    assertPublicPhase: assertPhase,
    invalidate,
    requireActor: async phaseId => {
      const session = await requireAuth();
      if (!session.player) throw new AuthError('Not a registered player', 403, 'forbidden');
      await assertPhase(phaseId);
      return {
        playerId: session.player.playerId,
        isSiteAdmin: session.player.isAdmin,
        isSuperadmin: isSuperadmin(session),
      };
    },
  });
}
