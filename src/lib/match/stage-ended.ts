/**
 * The read behind the "stage already ended" warning of a take-back (`StageEndedWarning`): which players the ended
 * phase moved into the next phases. Nothing here changes a phase: the take-back stays a take-back, the admin decides
 * what the advancement needs.
 */
import { isKitCandidate } from '@/lib/format-engine/kit-candidate';
import { logger } from '@/lib/logger';
import { getParticipantsBatch, getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import type { Tournament } from '@/types/tournament';
import type { StageEndedAdvance, StageEndedWarning } from './stage-ended-warning';

type EndedPhase = Pick<Tournament, 'id' | 'name' | 'status' | 'season_id' | 'season_format_type'>;

/**
 * What a phase moved into each next phase, from the next phases' enrollment records: a kit phase fed by several
 * sources keeps one block per source (`enrollment_source.contributions`), any other phase fed by this one took the
 * source's whole selection. A player an admin removed from the next phase since is no longer advanced and is left out.
 */
async function advancedFrom(phase: EndedPhase & { season_id: string }): Promise<StageEndedAdvance[]> {
  const stages = await getStagesBySeasonId(phase.season_id);
  const fed: { phase: (typeof stages)[number]; playerIds: string[] | null }[] = [];
  for (const stage of stages) {
    if (stage.id === phase.id) continue;
    const source = stage.enrollment_source;
    if (source?.type !== 'standings') continue;
    if (source.contributions !== undefined) {
      const block = source.contributions.find((contribution) => contribution.source_phase_id === phase.id);
      if (block) fed.push({ phase: stage, playerIds: block.player_ids });
    } else if (source.source_phase_id === phase.id) {
      fed.push({ phase: stage, playerIds: null });
    }
  }
  if (fed.length === 0) return [];

  const rosters = await getParticipantsBatch(fed.map((entry) => entry.phase.id));
  const advanced: StageEndedAdvance[] = [];
  for (const { phase: target, playerIds } of fed) {
    const roster = rosters.get(target.id) ?? [];
    const nameById = new Map(roster.map((participant) => [participant.id, participant.name]));
    const players =
      playerIds === null
        ? roster.map((participant) => ({ id: participant.id, name: participant.name }))
        : playerIds.flatMap((id) => {
            const name = nameById.get(id);
            return name === undefined ? [] : [{ id, name }];
          });
    if (players.length > 0) advanced.push({ phase_id: target.id, phase_name: target.name, players });
  }
  return advanced;
}

/**
 * The warning for a take-back, or null when none applies: only a result that stood (`resultTakenBack`: the match was
 * completed and no longer is) in a phase of a custom league whose status is already `completed`. Never throws: the
 * take-back is saved when this runs, so a failed read is logged and reported as an advancement that could not be read.
 */
export async function loadStageEndedWarning(
  phase: EndedPhase,
  resultTakenBack: boolean,
): Promise<StageEndedWarning | null> {
  if (!resultTakenBack || phase.status !== 'completed' || !isKitCandidate(phase)) return null;
  const base = { phase_id: phase.id, phase_name: phase.name };
  try {
    return { ...base, advanced: await advancedFrom(phase) };
  } catch (error) {
    logger.error('match/stage-ended', 'could not read which players advanced from a completed phase', {
      phaseId: phase.id,
      error,
    });
    return { ...base, advanced: null };
  }
}
