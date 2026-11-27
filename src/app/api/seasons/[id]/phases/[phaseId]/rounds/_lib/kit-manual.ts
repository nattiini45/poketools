import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { assertNoOpenRoundBeforeNext, assertPhaseReadyForFirstRound, isKitEnginePhase, loadKitPhaseOfTournament, wantsForcedStart } from '@/lib/format-engine/route-guards';
import { roundDeadlineIso } from '@/lib/format-engine/runtime/calendar';
import { fireEvent } from '@/lib/format-engine/runtime/fire';
import { onNativePhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { phaseById } from '@/lib/format-engine/runtime/load';
import { roundsBoundReached } from '@/lib/format-engine/runtime/stage-end';
import { checkStageEnd } from '@/lib/format-engine/runtime/stage-end-server';
import { logger } from '@/lib/logger';
import { getNativeKitMatchFacts } from '@/lib/supabase/queries/phase-format-runtime';
import { getRoundsByPhase, updatePhaseRoundDeadline } from '@/lib/supabase/queries/phase-rounds';
import type { SessionPlayer } from '@/types/auth';
import type { Phase, PhaseRound } from '@/types/league-phase';
import type { Season } from '@/types/season';
import { nativeRoundServices } from './effects';

export async function prepareManualKitRound(
  request: Request, season: Season, phase: Phase, rounds: PhaseRound[], actor: SessionPlayer,
) {
  if (season.format_type !== 'custom') return null;
  const { matches: { kit } } = nativeRoundServices(phase);
  const loaded = await loadKitPhaseOfTournament({ ...phase, season_format_type: season.format_type }, kit.storage);
  if (!isKitEnginePhase(loaded)) return null;
  await assertNoOpenRoundBeforeNext(phase.id, loaded, rounds, getNativeKitMatchFacts);
  const context = await kit.eventPort.load(season.id);
  const scoped = context && phaseById(context, phase.id);
  if (!context || !scoped || context.revision !== loaded.revision) {
    throw new UserFacingError('The league format changed while the round was being generated, so no round was written. Generate it again.', {
      code: 'format_context_stale', status: 409,
    });
  }
  const endWhen = scoped.stage.end_when;
  const end = endWhen?.kind === 'expr' ? await checkStageEnd(context, scoped, undefined, {
    rounds: getRoundsByPhase, matches: getNativeKitMatchFacts,
  }) : null;
  if (roundsBoundReached(endWhen, phase.current_round) || (end?.met && end.facts.rounds_played > 0)) {
    throw new UserFacingError('This phase has reached its end condition: no more rounds can be generated.', {
      code: 'rounds_stage_ended', status: 409,
    });
  }
  const forced = await assertPhaseReadyForFirstRound({ ...phase, season_format_type: season.format_type }, loaded, {
    force: wantsForcedStart(request), actor: { id: actor.playerId, name: actor.name },
  }, async () => context);
  return {
    revision: loaded.revision,
    async afterWrite(round: PhaseRound): Promise<PhaseRound> {
      if (forced) {
        logAuditEvent({
          actor_id: forced.actor.id, actor_name: forced.actor.name, action: 'season.format.round.force_start',
          resource_type: 'phase', resource_id: phase.id,
          metadata: { season_id: season.id, reasons: forced.gap.reasons, relations: forced.gap.undrawn, open_checks: forced.gap.openChecks },
        });
      }
      const calendar = scoped.stage.calendar;
      if (calendar && round.deadline === null) {
        try {
          const head = await kit.storage.head(season.id);
          if (head?.revision === loaded.revision) {
            const deadline = roundDeadlineIso(calendar, round.round_number, {
              seasonStart: season.start_date, shiftSeconds: head.clockShiftSeconds,
            });
            if (deadline !== null) round = await updatePhaseRoundDeadline(round.id, deadline);
            else logger.warn('phase-rounds', 'The stage calendar has no readable start', { phaseId: phase.id });
          }
        } catch (error) {
          logger.error('phase-rounds', 'Could not set the native round calendar deadline', { phaseId: phase.id, roundId: round.id, error });
        }
      }
      try {
        if (phase.status === 'upcoming') {
          await onNativePhaseStatusChanged({ phase, from: 'upcoming', to: 'active' }, kit.statusPort);
        }
        const fresh = await kit.eventPort.load(season.id);
        if (fresh?.revision === loaded.revision && phaseById(fresh, phase.id)) {
          const fired = await fireEvent(season.id, { event: 'round_start', stage: scoped.stage.key, round: round.round_number }, null, {
            context: fresh, port: kit.eventPort,
          });
          for (const issue of fired?.issues ?? []) logger.warn('phase-rounds', 'Native round start effect skipped', { phaseId: phase.id, ...issue });
        }
      } catch (error) {
        logger.error('phase-rounds', 'Could not apply native round start effects', { phaseId: phase.id, roundId: round.id, error });
      }
      return round;
    },
  };
}
