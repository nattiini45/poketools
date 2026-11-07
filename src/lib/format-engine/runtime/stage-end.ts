/**
 * The end of a stage (`Stage.end_when`): the facts of a phase, and whether its condition holds. A round is complete when
 * its status says so or when it has matches and every one is completed, so a league that never presses "complete
 * round" still ends. `rounds` ends the stage once that many rounds are complete; `expr` evaluates the stage env
 * (`round`, `rounds_played`, `open_matches`, `participants`, `tunable.*`). Pure and client-safe.
 */
import { evaluate } from '@/lib/format-kit/expr/eval';
import type { EndWhen } from '@/lib/format-kit/types';
import { stageContext, type EnvBase, type StageFacts } from './expr-env';

export type { StageFacts };

export interface FactRound {
  id: string;
  round_number: number;
  status: string;
}

export interface FactMatch {
  round_id: string;
  status: string;
}

export function stageFactsOf(rounds: readonly FactRound[], matches: readonly FactMatch[], participants: number): StageFacts {
  const byRound = new Map<string, FactMatch[]>();
  for (const match of matches) byRound.set(match.round_id, [...(byRound.get(match.round_id) ?? []), match]);
  let rounds_played = 0;
  let round = 0;
  for (const entry of rounds) {
    const own = byRound.get(entry.id) ?? [];
    const done = entry.status === 'completed' || (own.length > 0 && own.every((match) => match.status === 'completed'));
    if (!done) continue;
    rounds_played += 1;
    round = Math.max(round, entry.round_number);
  }
  return {
    round,
    rounds_played,
    open_matches: matches.filter((match) => match.status !== 'completed').length,
    participants,
  };
}

export type EndWhenResult = { met: boolean; issue?: string };

/** Whether `endWhen` holds. An expression that cannot be evaluated is not met and reports its issue code. */
export function evaluateEndWhen(endWhen: EndWhen, facts: StageFacts, base: EnvBase): EndWhenResult {
  if (endWhen.kind === 'rounds') return { met: facts.rounds_played >= endWhen.rounds };
  const result = evaluate(endWhen.when, stageContext(base, facts), 'boolean');
  if (!result.ok) return { met: false, issue: result.issue.code };
  return { met: result.value === true };
}

/**
 * Whether generating another round would go past the stage's end: a `rounds` bound is reached once the phase's round
 * counter (`tournaments.current_round`, the highest round written) has got there.
 */
export function roundsBoundReached(endWhen: EndWhen | undefined, currentRound: number): boolean {
  return endWhen?.kind === 'rounds' && currentRound >= endWhen.rounds;
}
