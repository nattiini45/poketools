import 'server-only';

import { createFormatCronPass, type FormatCronPort } from '@/lib/format-engine/runtime/cron';
import { fireEvent, fireLockedActionEvents } from '@/lib/format-engine/runtime/fire';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { isFormatContextStale } from '@/lib/format-engine/runtime/stale';
import { listKitSeasonIds, listKitIdleSeasonIds } from '@/lib/supabase/queries/format-cron';
import { listNativeKitCronPhases, listNativeFinalizedMatches, listNativeUncompletedMatches, completePhaseFormatForfeit } from '@/lib/supabase/queries/phase-format-cron';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById, getMatchesByPhase } from '@/lib/supabase/queries/phase-matches';
import { getRoundsByPhase, listRoundStatusesByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { createPhaseMatchServices } from './match-services';
import type { createNativeKitMatchEffects } from './kit-match-effects';

export interface NativeFormatCronInput {
  services: Pick<ReturnType<typeof createPhaseMatchServices>, 'stageAdminOutcome' | 'discardStagedAdminOutcome' | 'finalizeMatchCompletion'>;
  kit: ReturnType<typeof createNativeKitMatchEffects>;
  listTeams: FormatCronPort<PhaseMatchWithPlayers>['teams'];
  submitAction: FormatCronPort<PhaseMatchWithPlayers>['submitAction'];
  expireChallenges: FormatCronPort<PhaseMatchWithPlayers>['expireChallenges'];
  purgeNotifications: FormatCronPort<PhaseMatchWithPlayers>['purgeNotifications'];
  revalidate: FormatCronPort<PhaseMatchWithPlayers>['revalidate'];
}

export function createNativeFormatCronPass(input: NativeFormatCronInput) {
  return createFormatCronPass<PhaseMatchWithPlayers>({
    load: (id) => input.kit.eventPort.load(id),
    fireEvent: (id, event, actor, options) => fireEvent(id, event, actor, { ...options, port: input.kit.eventPort }),
    fireLockedActionEvents: (id, actor, options) => fireLockedActionEvents(id, actor, { ...options, port: input.kit.eventPort }),
    calendarPhases: () => listNativeKitCronPhases(),
    runningSeasons: () => listKitSeasonIds(),
    idleSeasons: () => listKitIdleSeasonIds(),
    finalized: (ids) => listNativeFinalizedMatches(ids),
    uncompleted: (ids, matches) => listNativeUncompletedMatches(ids, matches),
    roundStatuses: (ids) => listRoundStatusesByPhaseIds(ids),
    phase: (id) => getPhaseById(id),
    rounds: (id) => getRoundsByPhase(id),
    matches: (id) => getMatchesByPhase(id),
    match: (id) => getPhaseMatchById(id),
    ownerId: (match) => match.phase_id,
    teams: (id) => input.listTeams(id),
    submitAction: (...args) => input.submitAction(...args),
    completeForfeit: (value) => completePhaseFormatForfeit(value),
    stageAdminOutcome: (...args) => input.services.stageAdminOutcome(...args),
    discardStagedAdminOutcome: (...args) => input.services.discardStagedAdminOutcome(...args),
    finalize: (value) => input.services.finalizeMatchCompletion(value),
    revalidate: (...args) => input.revalidate(...args),
    auditForfeit: (match, status, plan, stage) => logAuditEvent({
      actor_id: null, actor_name: 'System', action: 'match.admin_result', resource_type: 'phase_match',
      resource_id: match.id, resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: { status: { before: status, after: 'completed' }, winner_id: { before: match.winner_id, after: plan.winnerId } },
      metadata: { via: 'deadline_policy', outcome: 'forfeit', phase_id: match.phase_id, loser_id: plan.loserId, reason: plan.reason, stage },
    }),
    completed: async (ctx, match, auditRetry, report) => {
      try {
        return await input.kit.completed({
          phase: { id: match.phase_id, season_id: ctx.seasonId }, matchId: match.id, roundId: match.round_id,
          player1Id: match.player_1_id, player2Id: match.player_2_id, winnerId: match.winner_id,
          confirmedAt: match.confirmed_at, auditRetry, report,
        });
      } catch (error) {
        if (isFormatContextStale(error)) report.stale = true;
        else report.failed = true;
        logger.error('format-engine/native-cron', 'native completion backfill could not read or apply its match context', { matchId: match.id, error });
        return false;
      }
    },
    reverted: (ctx, match, report) => input.kit.reverted({ phase: { id: match.phase_id, season_id: ctx.seasonId }, matchId: match.id, report }),
    roundCompleted: (ctx, round, report) => input.kit.roundCompleted({ phase: { id: round.phase_id, season_id: ctx.seasonId }, roundId: round.id, report }),
    completeStage: (...args) => input.kit.completeStage(...args),
    expireChallenges: (...args) => input.expireChallenges(...args),
    purgeNotifications: (...args) => input.purgeNotifications(...args),
  });
}
