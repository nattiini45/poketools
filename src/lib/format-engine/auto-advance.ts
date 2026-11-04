/**
 * The `auto` gate of a kit edge: when a phase completes, the players its format's `auto` edges select move into the
 * target phases at once, as if an admin had pressed Advance. An `admin_confirm` edge (the default) waits for the
 * admin. Server only.
 */
import 'server-only';

import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';

export interface AutoAdvanceResult {
  target_phase_id: string;
  enrolled_count: number;
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
    .flatMap((edge) => phases.find((phase) => phase.format_stage_key === edge.to)?.id ?? []);
}

/**
 * Runs every `auto` edge out of a phase that just completed into a target that has not started. A target that is
 * already running keeps its players (the enrollment guard refuses it). Errors propagate: the caller logs them and
 * the admin advances by hand (a `manual_list` edge always needs the admin's list).
 */
export async function runAutoAdvance(seasonId: string, sourcePhaseId: string): Promise<AutoAdvanceResult[]> {
  const out: AutoAdvanceResult[] = [];
  for (const targetId of await autoAdvanceTargets(seasonId, sourcePhaseId)) {
    const target = await getTournamentById(targetId);
    if (!target || target.status !== 'upcoming') continue;
    const result = await syncStandingsEnrollment(seasonId, targetId, { source_phase_id: sourcePhaseId });
    out.push({ target_phase_id: targetId, enrolled_count: result.enrolled_count });
  }
  return out;
}
