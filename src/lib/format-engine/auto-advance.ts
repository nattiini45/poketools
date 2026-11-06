/**
 * The `auto` gate of a kit edge: when a phase completes, the players its format's `auto` edges select move into the
 * target phases at once, as if an admin had pressed Advance. An `admin_confirm` edge (the default) waits for the
 * admin. Server only.
 *
 * A phase fed by several edges (a playoff taking the top of two groups stages) is the sum of its sources, not the
 * last source to finish. Each completed source moves its players in through `syncStandingsEnrollment`, which keeps the
 * entrants of the sources that contributed before (`mergeKitContributions`, recorded in the phase's
 * `enrollment_source.contributions`; the admin's Advance button does the same). The merged seed order is the order the
 * sources contributed: the first source to complete holds seeds 1..n in its edge's own seeding (`rank`, `cross_group`,
 * `random` or `manual`), the next source continues after it, a player already enrolled by an earlier edge keeps his
 * earlier seed. This is the spec's `edge_order` seeding ("in the order they advance"). When a source is advanced
 * again (a reopened phase completing once more) its own block is replaced in place and the others stay.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';

const TAG = 'format-engine/auto-advance';

export interface AutoAdvanceResult {
  target_phase_id: string;
  enrolled_count: number;
}

export interface AutoAdvanceTargetFailure {
  target_phase_id: string;
  error: unknown;
}

/**
 * One or more targets of an `auto` advance failed. The other targets were still advanced: `results` lists them, so the
 * caller expires their caches and audits them although the run as a whole failed.
 */
export class AutoAdvanceError extends Error {
  constructor(
    readonly results: AutoAdvanceResult[],
    readonly failures: AutoAdvanceTargetFailure[],
  ) {
    super(`auto advance failed for ${failures.length} target phase(s); ${results.length} advanced`, { cause: failures[0]?.error });
    this.name = 'AutoAdvanceError';
  }

  /** The code of the first failure when it is a user-facing one (the enrollment guard's refusals). */
  get code(): string | undefined {
    const first = this.failures[0]?.error;
    return first instanceof UserFacingError && first.code ? first.code : undefined;
  }
}

/** The phases the `auto` edges of a kit league lead into from `sourcePhaseId`; empty for any other league. */
export async function autoAdvanceTargets(seasonId: string, sourcePhaseId: string): Promise<string[]> {
  const format = await getSeasonFormat(seasonId);
  if (format === null || format.engine !== 'kit') return [];
  const phases = await getKitPhases(seasonId);
  const source = phases.find((phase) => phase.id === sourcePhaseId);
  if (!source) return [];
  return format.spec.edges
    .filter((edge) => edge.from === source.format_stage_key && edge.gate === 'auto')
    .flatMap((edge) => phases.filter((phase) => phase.format_stage_key === edge.to).map((phase) => phase.id));
}

/**
 * Runs every `auto` edge out of a phase that just completed into a target that has not started. A target that is
 * already running keeps its players (the enrollment guard refuses it). A target that fails does not stop the others:
 * every target is tried, then an `AutoAdvanceError` carries the targets that advanced and the ones that did not
 * (each failure is logged here with its original error). The caller reports it and the admin advances the failed
 * targets by hand (a `manual_list` edge always needs the admin's list). Errors before the first target (the format
 * or the phases cannot be read) propagate unchanged.
 */
export async function runAutoAdvance(seasonId: string, sourcePhaseId: string): Promise<AutoAdvanceResult[]> {
  const out: AutoAdvanceResult[] = [];
  const failures: AutoAdvanceTargetFailure[] = [];
  for (const targetId of await autoAdvanceTargets(seasonId, sourcePhaseId)) {
    try {
      const target = await getTournamentById(targetId);
      if (!target || target.status !== 'upcoming') continue;
      const result = await syncStandingsEnrollment(seasonId, targetId, { source_phase_id: sourcePhaseId });
      out.push({ target_phase_id: targetId, enrolled_count: result.enrolled_count });
    } catch (error) {
      logger.error(TAG, 'auto advance failed for a target phase', { seasonId, sourcePhaseId, targetId, error });
      failures.push({ target_phase_id: targetId, error });
    }
  }
  if (failures.length > 0) throw new AutoAdvanceError(out, failures);
  return out;
}
