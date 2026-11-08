/**
 * The `auto` edges out of a phase that has just completed, run after the format's reaction to the completion (the
 * `stage_end` event, which may adjust stage points) so that the players they move on are chosen from standings that
 * include that reaction. Shared by the stage-end path (`completePhaseAtStageEnd`) and `PATCH /api/tournaments/[id]`.
 * Server only.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { expireTournamentReads } from '@/lib/revalidation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { AutoAdvanceError, autoAdvanceTargets, runAutoAdvance, type AutoAdvanceResult } from '../auto-advance';
import { stageEnded } from './hooks';
import { loadFreshKitContext, phaseById } from './load';

const TAG = 'format-engine/stage-end-advance';

export interface StageEndAdvance {
  /** False when nothing was attempted: an earlier group of a stage still running, or (retry) no `auto` edge or a target already holding this phase's players. */
  ran: boolean;
  /** The targets that advanced, also when another target failed. */
  results: AutoAdvanceResult[];
  /** The code of the failure, or null when none. */
  error: string | null;
}

export interface StageEndAdvanceInput {
  seasonId: string;
  /** The phase that completed. */
  phaseId: string;
  /**
   * The advance is a repeat of one that was held back because the reaction failed (the phase was already completed when this
   * call came). `runAutoAdvance` recomputes the target's enrollment from the standings as they are now and writes it over the
   * enrollment the target has, so a repeat is only safe while no auto advance of this phase has happened: when any target
   * already holds a block of this phase's players (the first advance ran, or an admin pressed Advance), nothing is run, so
   * a later correction of the standings or of the enrollment is never overwritten.
   */
  retry: boolean;
}

/** Whether the target's enrollment already holds the block this phase contributed (`enrollment_source.contributions`). */
function holdsBlockOf(phaseId: string, target: Awaited<ReturnType<typeof getTournamentById>>): boolean {
  const source = target?.enrollment_source;
  return source?.contributions?.some((block) => block.source_phase_id === phaseId) === true;
}

function failureCode(error: unknown): string {
  if (error instanceof AutoAdvanceError) return error.code ?? 'auto_advance_failed';
  return error instanceof UserFacingError && error.code ? error.code : 'auto_advance_failed';
}

/**
 * The phases whose edges this completion runs. A stage that repeats per group fires `stage_end` with its last group phase, and
 * that event may adjust every group's points, so no group advances before it: an earlier group waits (nothing is run, and
 * that is no failure), and the last group runs them all. An earlier group never advanced, so `retry: true` is right for it:
 * it runs unless a target already holds its players (an admin pressed Advance meanwhile).
 */
async function advanceRuns(seasonId: string, phaseId: string, retry: boolean): Promise<{ phaseId: string; retry: boolean }[]> {
  const ctx = await loadFreshKitContext(seasonId);
  const phase = ctx === null ? undefined : phaseById(ctx, phaseId);
  if (ctx === null || phase === undefined || phase.stage.foreach_group === undefined) return [{ phaseId, retry }];
  if (!(await stageEnded(ctx, phase))) return [];
  const others = ctx.phases.filter((other) => other.stage.key === phase.stage.key && other.id !== phaseId);
  return [{ phaseId, retry }, ...others.map((other) => ({ phaseId: other.id, retry: true }))];
}

/** One phase's edges. False when nothing was attempted (see `StageEndAdvance.ran`). */
async function runOne(seasonId: string, phaseId: string, retry: boolean): Promise<AutoAdvanceResult[] | null> {
  if (retry) {
    const targets = await autoAdvanceTargets(seasonId, phaseId);
    const rows = await Promise.all(targets.map((targetId) => getTournamentById(targetId)));
    if (targets.length === 0 || rows.some((row) => holdsBlockOf(phaseId, row))) {
      if (targets.length > 0) logger.info(TAG, 'auto advance not repeated: a target already holds the players of this phase', { phaseId });
      return null;
    }
  }
  return runAutoAdvance(seasonId, phaseId);
}

/**
 * Runs the `auto` edges out of `phaseId` and expires the caches of the targets that advanced. Never throws: a failure is
 * logged with its original error and returned as a code, because the status change that led here stands and the admin's
 * Advance button remains.
 */
export async function advanceAfterStageEnd(input: StageEndAdvanceInput): Promise<StageEndAdvance> {
  const results: AutoAdvanceResult[] = [];
  let error: string | null = null;
  let ran = false;
  const fail = (phaseId: string, err: unknown): void => {
    logger.error(TAG, 'auto advance failed after the stage ended', { phaseId, error: err });
    error ??= failureCode(err);
    // The targets that did advance still show on their pages and in the audit entry.
    if (err instanceof AutoAdvanceError) results.push(...err.results);
  };
  let runs: { phaseId: string; retry: boolean }[] = [];
  try {
    runs = await advanceRuns(input.seasonId, input.phaseId, input.retry);
  } catch (err) {
    fail(input.phaseId, err);
  }
  for (const run of runs) {
    try {
      const done = await runOne(input.seasonId, run.phaseId, run.retry);
      if (done !== null) {
        ran = true;
        results.push(...done);
      }
    } catch (err) {
      ran = true;
      fail(run.phaseId, err);
    }
  }
  for (const entry of results) expireTournamentReads(entry.target_phase_id, input.seasonId);
  return { ran, results, error };
}
