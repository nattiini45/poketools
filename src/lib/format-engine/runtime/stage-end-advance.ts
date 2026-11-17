/**
 * The `auto` edges out of a phase that has just completed, run after the format's reaction to the completion (the
 * `stage_end` event, which may adjust stage points) so that the players they move on are chosen from standings that
 * include that reaction. Shared by the stage-end path (`completePhaseAtStageEnd`) and `PATCH /api/tournaments/[id]`.
 * Server only.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { expireSeasonReads, expireTournamentReads } from '@/lib/revalidation';
import { legacyKitStorage, type KitStoragePort } from '@/lib/league-phase/kit-storage';
import { AutoAdvanceError, autoAdvanceTargets, runAutoAdvance, type AutoAdvanceResult } from '../auto-advance';
import { eventKey } from './events';
import { stageEnded } from './hooks';
import { loadFreshKitContext, phaseById } from './load';

export interface StageEndAdvancePort {
  storage: KitStoragePort;
  loadContext: typeof loadFreshKitContext;
  invalidate(seasonId: string, phaseIds: readonly string[]): void;
}

const legacyStageEndAdvance: StageEndAdvancePort = {
  storage: legacyKitStorage,
  loadContext: (id) => loadFreshKitContext(id),
  invalidate: (seasonId, ids) => { for (const id of ids) expireTournamentReads(id, seasonId); },
};

export function nativeStageEndAdvance(storage: KitStoragePort): StageEndAdvancePort {
  return {
    storage,
    loadContext: (id) => loadFreshKitContext(id, storage),
    invalidate: (id) => expireSeasonReads(id),
  };
}

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
function holdsBlockOf(phaseId: string, target: Awaited<ReturnType<KitStoragePort['phase']>>): boolean {
  const source = target?.enrollment_source;
  return source?.contributions?.some((block) => block.source_phase_id === phaseId) === true;
}

/**
 * Whether the phase's `stage_end` event fired. A reaction can fail after it did (the tie and expression checks run later): the
 * points it adjusts are in the standings then, so that failure is no reason to hold the advance. A failed read answers false.
 */
export async function stageEndFired(seasonId: string, phaseId: string, port: StageEndAdvancePort = legacyStageEndAdvance): Promise<boolean> {
  try {
    const ctx = await port.loadContext(seasonId);
    const phase = ctx === null ? undefined : phaseById(ctx, phaseId);
    return ctx !== null && phase !== undefined && ctx.state.firedEventKeys.includes(eventKey({ event: 'stage_end', stage: phase.stage.key }));
  } catch (error) {
    logger.error(TAG, 'could not read whether the stage end fired; the advance stays held', { phaseId, error });
    return false;
  }
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
async function advanceRuns(seasonId: string, phaseId: string, retry: boolean, port: StageEndAdvancePort): Promise<{ phaseId: string; retry: boolean }[]> {
  const ctx = await port.loadContext(seasonId);
  const phase = ctx === null ? undefined : phaseById(ctx, phaseId);
  if (ctx === null || phase === undefined || phase.stage.foreach_group === undefined) return [{ phaseId, retry }];
  const ended = port === legacyStageEndAdvance ? await stageEnded(ctx, phase) : await stageEnded(ctx, phase, port.storage);
  if (!ended) return [];
  const others = ctx.phases.filter((other) => other.stage.key === phase.stage.key && other.id !== phaseId);
  return [{ phaseId, retry }, ...others.map((other) => ({ phaseId: other.id, retry: true }))];
}

/** One phase's edges. False when nothing was attempted (see `StageEndAdvance.ran`). */
async function runOne(seasonId: string, phaseId: string, retry: boolean, port: StageEndAdvancePort): Promise<AutoAdvanceResult[] | null> {
  if (retry) {
    const targets = port === legacyStageEndAdvance
      ? await autoAdvanceTargets(seasonId, phaseId)
      : await autoAdvanceTargets(seasonId, phaseId, port.storage);
    const rows = await Promise.all(targets.map((targetId) => port.storage.phase(targetId)));
    if (targets.length === 0 || rows.some((row) => holdsBlockOf(phaseId, row))) {
      if (targets.length > 0) logger.info(TAG, 'auto advance not repeated: a target already holds the players of this phase', { phaseId });
      return null;
    }
  }
  return port === legacyStageEndAdvance
    ? runAutoAdvance(seasonId, phaseId)
    : runAutoAdvance(seasonId, phaseId, port.storage);
}

/**
 * Runs the `auto` edges out of `phaseId` and expires the caches of the targets that advanced. Never throws: a failure is
 * logged with its original error and returned as a code, because the status change that led here stands and the admin's
 * Advance button remains.
 */
export async function advanceAfterStageEnd(input: StageEndAdvanceInput, port: StageEndAdvancePort = legacyStageEndAdvance): Promise<StageEndAdvance> {
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
    runs = await advanceRuns(input.seasonId, input.phaseId, input.retry, port);
  } catch (err) {
    fail(input.phaseId, err);
  }
  for (const run of runs) {
    try {
      const done = await runOne(input.seasonId, run.phaseId, run.retry, port);
      if (done !== null) {
        ran = true;
        results.push(...done);
      }
    } catch (err) {
      ran = true;
      fail(run.phaseId, err);
    }
  }
  port.invalidate(input.seasonId, results.map((entry) => entry.target_phase_id));
  return { ran, results, error };
}
