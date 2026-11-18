import 'server-only';

import { logger } from '@/lib/logger';
import { createKitMatchEffects, onNativePhaseStatusChanged, type KitMatchCompletedInput } from '@/lib/format-engine/runtime/hooks';
import { awaitsCompletionEffects, currentCompletionKeyOf } from '@/lib/format-engine/runtime/events';
import { loadFreshKitContext, phaseById, phasesOfStageKey, type KitContext } from '@/lib/format-engine/runtime/load';
import { loadStageTable, playerRowsOf, type StageTablePort } from '@/lib/format-engine/runtime/stage-table';
import { checkStageEnd } from '@/lib/format-engine/runtime/stage-end-server';
import type { KitEventPort } from '@/lib/format-engine/runtime/fire';
import { isFormatContextStale } from '@/lib/format-engine/runtime/stale';
import type { PlayerRow } from '@/lib/format-engine/runtime/types';
import { loadStageEndedWarning } from '@/lib/match/stage-ended';
import { completePhaseIfActive, getPhaseById, getPhasesBySeasonId, getPhaseParticipantsBatch } from '@/lib/supabase/queries/league-phases';
import { getPhaseRoundById, getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { firePhaseFormatMatchEvent } from '@/lib/supabase/queries/format-runtime';
import { getNativeKitOutcomes, getNativeKitMatchIds, getNativeKitGameCounts, getNativeKitKills, getNativeKitCompletedRecords, getNativeKitMatchFacts } from '@/lib/supabase/queries/phase-format-runtime';
import type { Phase } from '@/types/league-phase';
import { nativeKitStorage, type NativeKitConsumers } from './kit-storage';
import type { NativeKitStatusPort } from './kit-events';

export interface NativeKitMatchCallbacks {
  enroll: NativeKitConsumers['enroll'];
  auditMatchTeams(input: KitMatchCompletedInput, generation: number, context: KitContext): Promise<void>;
  stageCompleted(input: {
    phase: Phase;
    reason: string;
    retry: boolean;
    reaction: Awaited<ReturnType<typeof onNativePhaseStatusChanged>>;
  }): Promise<void>;
  invalidate(seasonId: string, phaseIds: readonly string[]): void;
}

export function createNativePhaseStatusPort({ enroll, invalidate }: Pick<NativeKitMatchCallbacks, 'enroll' | 'invalidate'>): NativeKitStatusPort {
  const storage = nativeKitStorage({
    outcomes: getNativeKitOutcomes,
    matchIds: getNativeKitMatchIds,
    gameCounts: getNativeKitGameCounts,
    kills: getNativeKitKills,
    enroll,
  });
  const tablePort: StageTablePort = {
    storage, matches: getNativeKitCompletedRecords, rounds: getRoundsByPhase, groups: getGroupsByPhase,
  };
  const table = (ctx: KitContext, id: string) => loadStageTable(ctx, id, tablePort);
  const settled: NativeKitStatusPort['settled'] = async (ctx, id) => {
    const fired = new Set(ctx.state.firedEventKeys);
    const keyOf = currentCompletionKeyOf(ctx.state.firedEventKeys);
    return !(await getNativeKitMatchFacts(id)).some((match) => awaitsCompletionEffects(match, fired, keyOf));
  };
  return { storage, table, settled, writeEvent: (input) => firePhaseFormatMatchEvent(input), invalidate };
}

export function createNativeKitMatchEffects(callbacks: NativeKitMatchCallbacks) {
  const statusPort = createNativePhaseStatusPort(callbacks);
  const { storage, table } = statusPort;
  const load = (seasonId: string) => loadFreshKitContext(seasonId, storage);
  const event: KitEventPort = {
    load,
    write: (input) => firePhaseFormatMatchEvent(input),
    invalidate: callbacks.invalidate,
    rows: async (ctx, stage) => {
      const rows = await Promise.all((stage === undefined ? ctx.phases.slice(0, 1) : phasesOfStageKey(ctx, stage)).map((phase) => table(ctx, phase.id)));
      if (rows.every((row) => row === null)) return undefined;
      const result: Record<string, PlayerRow> = {};
      for (const row of rows) if (row !== null) Object.assign(result, playerRowsOf(row));
      return result;
    },
  };
  async function completeStage(phaseId: string, reason: string, knownUnfinished: readonly string[]): Promise<'completed' | 'skipped' | 'reaction_failed'> {
    const before = await getPhaseById(phaseId);
    if (before === null || (before.status !== 'active' && before.status !== 'completed')) return 'skipped';
    let completed = before;
    const retry = before.status === 'completed';
    if (!retry) {
      const claim = await completePhaseIfActive(phaseId, knownUnfinished);
      if (claim.outcome !== 'completed') return 'skipped';
      completed = claim.phase;
    }
    const reaction = await onNativePhaseStatusChanged({ phase: completed, from: before.status, to: 'completed', retry }, statusPort);
    callbacks.invalidate(before.season_id, [phaseId]);
    if (!retry || reaction.advance.ran) await callbacks.stageCompleted({ phase: completed, reason, retry, reaction });
    return reaction.applied ? (retry ? 'skipped' : 'completed') : 'reaction_failed';
  }
  const shared = createKitMatchEffects({
    event,
    round: (id) => getPhaseRoundById(id),
    rounds: (id) => getRoundsByPhase(id),
    matches: (id) => getNativeKitMatchFacts(id),
    match: (id) => getPhaseMatchById(id),
    outcome: (id) => getPhaseMatchOutcome(id),
    audit: callbacks.auditMatchTeams,
    endStage: async (scope, _stale, _phase, roundId, report, retry = false) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const ctx = await load(scope.season_id);
          const phase = ctx === null ? undefined : phaseById(ctx, scope.id);
          if (ctx === null || phase === undefined) return true;
          const check = await checkStageEnd(ctx, phase, roundId, { rounds: getRoundsByPhase, matches: getNativeKitMatchFacts });
          if (check === null || check.openInRound > 0) return true;
          if (check.issue !== undefined) {
            logger.warn('format-engine/native-match', 'end_when could not be evaluated', { phaseId: scope.id, issue: check.issue });
            return true;
          }
          if (!check.met) return true;
          const before = await getPhaseById(scope.id);
          if (before === null || before.season_id !== scope.season_id) throw new Error('native stage owner changed');
          if (before.status !== 'active' && before.status !== 'completed') return true;
          const result = await completeStage(scope.id, `end_when:${phase.stage.key}`, check.unfinishedMatchIds);
          if (result === 'reaction_failed') throw new Error('the native stage end reaction did not apply');
          return true;
        } catch (error) {
          if (retry && attempt === 0) {
            logger.warn('format-engine/native-match', 'native stage end failed, trying once more', { phaseId: scope.id });
            continue;
          }
          if (report !== undefined) {
            if (isFormatContextStale(error)) report.stale = true;
            else report.failed = true;
          }
          logger.error('format-engine/native-match', 'native stage end failed', { phaseId: scope.id, error });
          return false;
        }
      }
    },
  });
  return {
    storage,
    statusPort,
    eventPort: event,
    completeStage,
    roundCompleted: shared.roundCompleted,
    completed: async (input: Omit<KitMatchCompletedInput, 'confirmedAt'> & { confirmedAt: string | null }) => {
      if (input.confirmedAt === undefined) throw new Error('native match completion requires an explicit confirmed_at fence');
      const [match, round] = await Promise.all([getPhaseMatchById(input.matchId), getPhaseRoundById(input.roundId)]);
      if (match === null || round === null || match.phase_id !== input.phase.id || round.phase_id !== input.phase.id || match.round_id !== round.id
        || match.player_1_id !== input.player1Id || match.player_2_id !== input.player2Id) throw new Error('native match hook context does not match its phase');
      return shared.completed(input);
    },
    reverted: shared.reverted,
    unresolved: shared.unresolved,
    stageEndedWarning: (phase: Phase, takenBack: boolean) => loadStageEndedWarning(phase, takenBack, {
      stages: (id) => getPhasesBySeasonId(id), participants: (ids) => getPhaseParticipantsBatch(ids),
    }),
  };
}
