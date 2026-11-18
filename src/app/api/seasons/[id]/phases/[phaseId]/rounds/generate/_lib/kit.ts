import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { loadKitPhase } from '@/lib/format-engine/load';
import { kitPairsRounds } from '@/lib/format-engine/pairing';
import { openForbiddenPairingCheck } from '@/lib/format-engine/pairing-server';
import { assertNoRoundOpenAhead, assertPhaseGenerates, assertPhaseReadyForFirstRound, isKitEnginePhase, wantsForcedStart } from '@/lib/format-engine/route-guards';
import { roundDeadlineIso } from '@/lib/format-engine/runtime/calendar';
import { planChecks } from '@/lib/format-engine/runtime/checks';
import { openChecks } from '@/lib/format-engine/runtime/checks-server';
import type { KitEvent } from '@/lib/format-engine/runtime/events';
import { fireEvent } from '@/lib/format-engine/runtime/fire';
import { phaseById } from '@/lib/format-engine/runtime/load';
import { roundsBoundReached } from '@/lib/format-engine/runtime/stage-end';
import { checkStageEnd } from '@/lib/format-engine/runtime/stage-end-server';
import { assertSeasonFormatAttached } from '@/lib/format-studio/attach';
import { logger } from '@/lib/logger';
import { getNativeKitMatchFacts } from '@/lib/supabase/queries/phase-format-runtime';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import type { GeneratedRound } from '@/lib/tournament/types';
import type { SessionPlayer } from '@/types/auth';
import type { Phase, PhaseRound } from '@/types/league-phase';
import type { Season } from '@/types/season';
import { nativeRoundServices } from '../../_lib/effects';

export async function prepareNativeGenerationKit(input: {
  request: Request;
  season: Season;
  phase: Phase;
  rounds: PhaseRound[];
  matches: Awaited<ReturnType<typeof getNativeKitMatchFacts>>;
  actor: SessionPlayer;
  kit: ReturnType<typeof nativeRoundServices>['matches']['kit'];
}) {
  const { season, phase, kit, matches, rounds, actor, request } = input;
  if (season.format_type !== 'custom') return null;
  await assertSeasonFormatAttached(season.id);
  const head = await kit.storage.head(season.id);
  if (!head) throw stale();
  if (head.engine !== 'kit') return { revision: head.revision, pairing: null } as const;

  const pairing = await loadKitPhase(season.id, phase.id, kit.storage);
  if (!isKitEnginePhase(pairing) || pairing.revision !== head.revision) throw stale();
  assertPhaseGenerates(pairing);
  if (!kitPairsRounds(pairing.stage)) {
    throw new UserFacingError('Elimination brackets are built by the bracket engine. Use Generate Bracket instead.', { code: 'BRACKET_V2_REQUIRED' });
  }
  assertNoRoundOpenAhead(pairing, rounds, matches);
  const context = await kit.eventPort.load(season.id);
  const scoped = context && phaseById(context, phase.id);
  if (!context || !scoped || context.revision !== head.revision) throw stale();
  const endWhen = scoped.stage.end_when;
  const end = endWhen?.kind === 'expr' ? await checkStageEnd(context, scoped, undefined, {
    rounds: getRoundsByPhase, matches: getNativeKitMatchFacts,
  }) : null;
  if (roundsBoundReached(endWhen, phase.current_round) || (end?.met && end.facts.rounds_played > 0)) {
    throw new UserFacingError('This phase has reached its end condition: no more rounds can be generated.', { code: 'rounds_stage_ended', status: 409 });
  }
  const forced = await assertPhaseReadyForFirstRound({ ...phase, season_format_type: season.format_type }, pairing, {
    force: wantsForcedStart(request), actor: { id: actor.playerId, name: actor.name },
  }, async () => context);

  return {
    revision: head.revision, pairing, context,
    deadline(roundNumber: number) {
      if (!scoped.stage.calendar) return null;
      const deadline = roundDeadlineIso(scoped.stage.calendar, roundNumber, {
        seasonStart: season.start_date, shiftSeconds: head.clockShiftSeconds,
      });
      if (deadline === null) logger.warn('phase-rounds/generate', 'The stage calendar has no readable start', { phaseId: phase.id });
      return deadline;
    },
    async afterWrite(round: GeneratedRound) {
      if (forced) {
        logAuditEvent({
          actor_id: forced.actor.id, actor_name: forced.actor.name, action: 'season.format.round.force_start',
          resource_type: 'phase', resource_id: phase.id,
          metadata: { season_id: season.id, reasons: forced.gap.reasons, relations: forced.gap.undrawn, open_checks: forced.gap.openChecks },
        });
      }
      const { round_number: number, rematches = 0, forbidden = 0 } = round;
      const stage = scoped.stage.key;
      const port = {
        ...kit.eventPort,
        async load(seasonId: string) {
          const fresh = await kit.eventPort.load(seasonId);
          return fresh?.revision === head.revision && phaseById(fresh, phase.id) ? fresh : null;
        },
      };
      const events: KitEvent[] = [{ event: 'round_start', stage, round: number }];
      if (phase.status === 'upcoming') events.unshift({ event: 'stage_start', stage });
      for (const event of events) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const fired = await fireEvent(season.id, event, null, { port });
            for (const issue of fired?.issues ?? []) logger.warn('phase-rounds/generate', 'Native round start effect skipped', { phaseId: phase.id, ...issue });
            break;
          } catch (error) {
            logger.error('phase-rounds/generate', 'Could not apply native round start effect', { phaseId: phase.id, round: number, event: event.event, attempt, error });
          }
        }
      }
      try {
        if (rematches > 0) {
          const plan = planChecks(context.def, { source: 'pairing_rematch', stage, round: number, rematches });
          await openChecks(season.id, plan.checks, head.revision);
        }
      } catch (error) {
        logger.error('phase-rounds/generate', 'Could not open native Swiss rematch checks', { phaseId: phase.id, round: number, error });
      }
      if (forbidden > 0) {
        await openForbiddenPairingCheck({ seasonId: season.id, stageKey: stage, round: number, forbidden, revision: head.revision });
      }
    },
  };
}

function stale() {
  return new UserFacingError('The league format changed while the round was being generated, so no round was written. Generate it again.', {
    code: 'format_context_stale', status: 409,
  });
}
