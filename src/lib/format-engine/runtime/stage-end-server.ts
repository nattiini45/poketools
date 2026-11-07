/**
 * Reads the facts of a kit phase and evaluates the `end_when` of its stage. Server only.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Stage } from '@/lib/format-kit/types';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { currentCompletionKeyOf } from './events';
import { envBaseOf, loadFreshKitContext, phaseById, type KitContext, type KitPhaseInfo } from './load';
import { evaluateEndWhen, roundsBoundReached, stageFactsOf, type StageFacts } from './stage-end';

export interface StageEndCheck {
  met: boolean;
  /** The code of the expression issue when the condition could not be evaluated. */
  issue?: string;
  facts: StageFacts;
  /**
   * Matches that must finish before the phase may end (0 when no round was named). Two kinds count:
   * - the round named by the caller: a match not completed, or completed with a winner while its current `match_completed`
   *   event has not fired yet (the finalize is in flight, failed and waits for the heal, or the cron backfill has not
   *   reached it). The phase must not end before those effects exist;
   * - every other round the admin has not completed by force: a match that is not completed. A straggler of an earlier
   *   round must not end the phase over a later round written meanwhile, and a round robin written in advance must not end
   *   at its first round over the rest. The last match of the other round evaluates `end_when` through its own hook, so
   *   no evaluation is lost. A round the admin completed by force settles its own leftovers (the completion lists them).
   */
  openInRound: number;
  /**
   * The ids of every match of the phase that was not completed when the facts were read. The phase's completion hands
   * them to the database, which refuses it when an unfinished match exists beyond these (a challenge accepted since).
   */
  unfinishedMatchIds: string[];
}

/**
 * Null when the phase's stage has no `end_when`. `roundId` names the round whose open matches `openInRound` counts;
 * `ctx` must have been loaded after the caller's own `match_completed` event fired, or that match counts as open.
 */
export async function checkStageEnd(ctx: KitContext, phase: KitPhaseInfo, roundId?: string): Promise<StageEndCheck | null> {
  const endWhen = phase.stage.end_when;
  if (endWhen === undefined) return null;
  const [rounds, matches] = await Promise.all([getRoundsByTournament(phase.id), getMatchesByTournament(phase.id)]);
  const facts = stageFactsOf(rounds, matches, phase.members.length);
  const keyOf = currentCompletionKeyOf(ctx.state.firedEventKeys);
  const fired = new Set(ctx.state.firedEventKeys);
  const settledByForce = new Set(rounds.filter((round) => round.id !== roundId && round.status === 'completed').map((round) => round.id));
  const knownRounds = new Set(rounds.map((round) => round.id));
  const openInRound =
    roundId === undefined
      ? 0
      : matches.filter((match) => {
          if (match.round_id === roundId) return match.status !== 'completed' || (match.winner_id !== null && !fired.has(keyOf(match.id)));
          return match.status !== 'completed' && knownRounds.has(match.round_id) && !settledByForce.has(match.round_id);
        }).length;
  const result = evaluateEndWhen(endWhen, facts, envBaseOf(ctx, `stage_end:${phase.stage.key}`));
  return {
    met: result.met,
    ...(result.issue !== undefined ? { issue: result.issue } : {}),
    facts,
    openInRound,
    unfinishedMatchIds: matches.filter((match) => match.status !== 'completed').map((match) => match.id),
  };
}

export interface GenerationGuardInput {
  seasonId: string;
  phaseId: string;
  stage: Pick<Stage, 'end_when'>;
  /** `tournaments.current_round` of the phase. */
  currentRound: number;
}

/**
 * Refuses another round for a phase whose stage already reached its end (409 `rounds_stage_ended`). A `rounds` bound
 * needs no read; an expression is evaluated over the phase's facts and only counts once a round was played, so
 * `open_matches == 0` cannot block the first round.
 */
export async function assertStageNotEnded(input: GenerationGuardInput): Promise<void> {
  const endWhen = input.stage.end_when;
  if (endWhen === undefined) return;
  let met = roundsBoundReached(endWhen, input.currentRound);
  if (!met && endWhen.kind === 'expr') {
    const ctx = await loadFreshKitContext(input.seasonId);
    const phase = ctx === null ? undefined : phaseById(ctx, input.phaseId);
    const check = ctx === null || phase === undefined ? null : await checkStageEnd(ctx, phase);
    met = check !== null && check.met && check.facts.rounds_played > 0;
  }
  if (met) {
    throw new UserFacingError('This phase has reached its end condition: no more rounds can be generated.', {
      code: 'rounds_stage_ended',
      status: 409,
    });
  }
}
