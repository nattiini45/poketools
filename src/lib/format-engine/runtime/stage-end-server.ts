/**
 * Reads the facts of a kit phase and evaluates the `end_when` of its stage. Server only.
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Stage } from '@/lib/format-kit/types';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { envBaseOf, loadFreshKitContext, phaseById, type KitContext, type KitPhaseInfo } from './load';
import { evaluateEndWhen, roundsBoundReached, stageFactsOf, type StageFacts } from './stage-end';

export interface StageEndCheck {
  met: boolean;
  /** The code of the expression issue when the condition could not be evaluated. */
  issue?: string;
  facts: StageFacts;
  /** Matches of the round named by the caller that are still open (0 when none was named). */
  openInRound: number;
}

/** Null when the phase's stage has no `end_when`. `roundId` names the round whose open matches `openInRound` counts. */
export async function checkStageEnd(ctx: KitContext, phase: KitPhaseInfo, roundId?: string): Promise<StageEndCheck | null> {
  const endWhen = phase.stage.end_when;
  if (endWhen === undefined) return null;
  const [rounds, matches] = await Promise.all([getRoundsByTournament(phase.id), getMatchesByTournament(phase.id)]);
  const facts = stageFactsOf(rounds, matches, phase.members.length);
  const openInRound = roundId === undefined ? 0 : matches.filter((match) => match.round_id === roundId && match.status !== 'completed').length;
  const result = evaluateEndWhen(endWhen, facts, envBaseOf(ctx, `stage_end:${phase.stage.key}`));
  return { met: result.met, ...(result.issue !== undefined ? { issue: result.issue } : {}), facts, openInRound };
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
