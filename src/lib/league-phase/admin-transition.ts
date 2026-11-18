import 'server-only';
import { updatePhase } from '@/lib/supabase/queries/league-phases';
import { expirePhaseReads, expireSeasonReads } from '@/lib/revalidation';
import { onNativePhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { createNativePhaseEnrollment } from './enrollment-services';
import { createNativePhaseStatusPort } from './kit-match-effects';
import { announcePhaseCompletion } from './announcements';
import type { Phase } from '@/types/league-phase';
import type { TournamentUpdateOutcome } from '@/lib/tournament/tournament-transition';

export async function updateAdminPhase(
  before: Phase,
  update: Parameters<typeof updatePhase>[1],
): Promise<Omit<TournamentUpdateOutcome, 'tournament'> & { phase: Phase }> {
  const { ruleset_id, ...fields } = update;
  const patch = ruleset_id === before.ruleset_id ? fields : update;
  const writes = Object.keys(patch).length > 0;
  const phase = writes
    ? await updatePhase(before.id, patch, { from: before.status, seasonId: before.season_id })
    : before;
  if (writes) expirePhaseReads(phase.id, phase.season_id);

  const to = update.status;
  const retry = to !== undefined && to === before.status;
  const reaction = before.format_stage_key !== null && (to === 'active' || to === 'completed')
    ? await onNativePhaseStatusChanged({
      phase,
      from: retry && to === 'active' ? 'upcoming' : before.status,
      to,
      retry,
    }, createNativePhaseStatusPort({
      enroll: createNativePhaseEnrollment().enroll,
      invalidate: (seasonId, phaseIds) => expireSeasonReads(seasonId, { phaseIds }),
    }))
    : null;
  if (to === 'completed' && !retry) announcePhaseCompletion(phase);

  return {
    phase,
    formatReactionFailed: reaction !== null && !reaction.applied,
    autoAdvance: reaction?.advance.results ?? [],
    autoAdvanceError: reaction?.advance.error ?? null,
    autoAdvanceHeld: reaction?.held ?? false,
    autoAdvanceRepeated: retry && (reaction?.advance.ran ?? false),
  };
}
