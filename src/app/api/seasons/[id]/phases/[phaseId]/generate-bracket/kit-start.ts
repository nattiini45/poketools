import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import {
  assertPhaseReadyForFirstRound, isKitEnginePhase, loadKitPhaseOfTournament, wantsForcedStart,
} from '@/lib/format-engine/route-guards';
import { fireEvent } from '@/lib/format-engine/runtime/fire';
import { onNativePhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { phaseById } from '@/lib/format-engine/runtime/load';
import { logger } from '@/lib/logger';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import type { SessionPlayer } from '@/types/auth';
import type { Phase } from '@/types/league-phase';
import type { SeasonFormatType } from '@/types/season';
import { nativeRoundServices } from '../rounds/_lib/effects';

export async function loadNativeKitBracket(phase: Phase, seasonFormat: SeasonFormatType) {
  if (seasonFormat !== 'custom') return null;
  const { matches: { kit } } = nativeRoundServices(phase);
  const source = { ...phase, season_format_type: seasonFormat };
  const loaded = await loadKitPhaseOfTournament(source, kit.storage);
  if (!isKitEnginePhase(loaded)) return null;

  return {
    async prepareStart(request: Request, actor: SessionPlayer) {
      const context = await kit.eventPort.load(phase.season_id);
      const scoped = context && phaseById(context, phase.id);
      if (!context || !scoped || context.revision !== loaded.revision) {
        throw new UserFacingError('The league format changed while the round was being generated, so no round was written. Generate it again.', {
          code: 'format_context_stale', status: 409,
        });
      }
      const forced = await assertPhaseReadyForFirstRound(source, loaded, {
        force: wantsForcedStart(request), actor: { id: actor.playerId, name: actor.name },
      }, async () => context);

      return async () => {
        if (forced) {
          logAuditEvent({
            actor_id: forced.actor.id, actor_name: forced.actor.name, action: 'season.format.round.force_start',
            resource_type: 'phase', resource_id: phase.id,
            metadata: { season_id: phase.season_id, reasons: forced.gap.reasons, relations: forced.gap.undrawn, open_checks: forced.gap.openChecks },
          });
        }
        try {
          const rounds = await getRoundsByPhase(phase.id);
          const first = rounds[0];
          let fresh = await kit.eventPort.load(phase.season_id);
          if (!first || fresh?.revision !== loaded.revision || !phaseById(fresh, phase.id)) {
            logger.warn('phase-bracket', 'Native bracket start effects skipped: the bracket or its format changed', { phaseId: phase.id });
            return;
          }
          if (phase.status === 'upcoming') {
            const started = await onNativePhaseStatusChanged({ phase, from: 'upcoming', to: 'active' }, kit.statusPort);
            if (!started.applied) logger.error('phase-bracket', 'Native stage start effect did not apply', { phaseId: phase.id });
            fresh = await kit.eventPort.load(phase.season_id);
            if (fresh?.revision !== loaded.revision || !phaseById(fresh, phase.id)) {
              logger.warn('phase-bracket', 'Native round start effect skipped: the format changed', { phaseId: phase.id });
              return;
            }
          }
          const fired = await fireEvent(phase.season_id, { event: 'round_start', stage: scoped.stage.key, round: first.round_number }, null, {
            context: fresh, port: kit.eventPort,
          });
          for (const issue of fired?.issues ?? []) logger.warn('phase-bracket', 'Native bracket start effect skipped', { phaseId: phase.id, ...issue });
        } catch (error) {
          logger.error('phase-bracket', 'Could not apply native bracket start effects', { phaseId: phase.id, error });
        }
      };
    },
  };
}
