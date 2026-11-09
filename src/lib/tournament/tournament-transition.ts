import { updateTournament } from '@/lib/supabase/queries/tournaments';
import { onPhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { advanceAfterStageEnd, stageEndFired } from '@/lib/format-engine/runtime/stage-end-advance';
import type { AutoAdvanceResult } from '@/lib/format-engine/auto-advance';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import type { Tournament } from '@/types/tournament';
import { tournamentMachine, type TournamentActor } from './tournament-state';

export type TournamentUpdate = Parameters<typeof updateTournament>[1];

export interface TournamentUpdateOutcome {
  tournament: Tournament;
  formatReactionFailed: boolean;
  autoAdvance: AutoAdvanceResult[];
  autoAdvanceError: string | null;
  /** The reaction failed before its stage_end fired, so the auto advance was held back. */
  autoAdvanceHeld: boolean;
  /** A repeat of `completed` ran the advance that an earlier failed reaction held back. */
  autoAdvanceRepeated: boolean;
}

/**
 * Writes an admin update of a tournament or league phase and, when it carries a status, moves the status through
 * `tournamentMachine`: the move is checked (409 `state_transition_invalid`), the write is a compare-and-set on the status
 * read in `before` (409 `tournament_status_changed`), and the format reaction, the auto advance and the completion
 * announcement run after it. Both PATCH routes (tournament and league phase) call this, so a phase completed from either
 * page has the same effects. `afterWrite` runs between the write and the status effects (the tournament route's bracket
 * syncs).
 */
export async function updateTournamentWithStatus(
  before: Tournament,
  update: TournamentUpdate,
  options: { actor: TournamentActor; afterWrite?: (tournament: Tournament) => Promise<void> },
): Promise<TournamentUpdateOutcome> {
  const to = update.status;
  const moves = to !== undefined && to !== before.status;
  if (moves) tournamentMachine.assertTransition(before.status, to, options.actor);

  const tournament =
    to === undefined
      ? await updateTournament(before.id, update)
      : await updateTournament(before.id, update, { from: before.status });
  await options.afterWrite?.(tournament);

  // A kit league's format reacts to a phase that starts or completes (stage_start, stage_end, standings tie checks).
  // Best effort and logged inside: the hook never fails the status change. A repeat of the same status replays the
  // reaction (its events and checks are keyed, so it is a no-op once applied): a first call whose reaction failed or died
  // after the status committed is repaired by sending it again. A failed reaction is reported, not dropped.
  let formatReactionFailed = false;
  if (to !== undefined && (moves || to === 'active' || to === 'completed')) {
    const from = moves ? before.status : to === 'completed' ? 'active' : 'upcoming';
    formatReactionFailed = !(await onPhaseStatusChanged({ tournament: before, from, to }));
  }

  // A kit league phase that completes runs the `auto` edges out of it, after the reaction above: a format can adjust stage
  // points on stage_end, and the players who move on are picked from the standings as they are then. A reaction that
  // failed holds the advance back (recorded in the audit entry; sending the same status again replays the reaction and,
  // once it applies, the advance). Best effort: the status change stands, and a failed advance is logged, recorded in the
  // audit entry and left to the admin's Advance button. A repeat of `completed` runs the advance only while no target holds
  // this phase's players yet (the advance rewrites a target's enrollment from the current standings).
  let autoAdvance: AutoAdvanceResult[] = [];
  let autoAdvanceError: string | null = null;
  let autoAdvanceHeld = false;
  let autoAdvanceRepeated = false;
  if (to === 'completed' && before.season_id && before.season_format_type === 'custom') {
    // Only a reaction that failed before its event fired holds it back: after that the standings are final.
    if (formatReactionFailed && !(await stageEndFired(before.season_id, before.id))) {
      autoAdvanceHeld = true;
    } else {
      const retry = before.status === 'completed';
      const advance = await advanceAfterStageEnd({ seasonId: before.season_id, phaseId: before.id, retry });
      autoAdvance = advance.results;
      autoAdvanceError = advance.error;
      autoAdvanceRepeated = retry && advance.ran;
    }
  }

  if (moves && to === 'completed') {
    const completedPayload = {
      event_type: 'tournament_completed' as const,
      tournament_id: before.id,
      season_id: tournament.season_id,
      data: {
        kind: 'tournament_status' as const,
        tournament_name: tournament.name,
        new_status: 'completed' as const,
      },
    };
    void emitDiscordEvent(completedPayload);
    void emitSocialEvent(completedPayload);
  }

  return { tournament, formatReactionFailed, autoAdvance, autoAdvanceError, autoAdvanceHeld, autoAdvanceRepeated };
}

/** The audit metadata of the status effects; empty when none ran or failed. */
export function statusEffectsAuditMetadata(outcome: TournamentUpdateOutcome): Record<string, unknown> {
  return {
    ...(outcome.formatReactionFailed ? { format_reaction_error: 'phase_status_hook_failed' } : {}),
    ...(outcome.autoAdvanceHeld ? { auto_advance_held: true } : {}),
    ...(outcome.autoAdvanceRepeated ? { auto_advance_repeated: true } : {}),
    ...(outcome.autoAdvance.length > 0 || outcome.autoAdvanceError
      ? { auto_advance: outcome.autoAdvance, auto_advance_error: outcome.autoAdvanceError }
      : {}),
  };
}
