/**
 * Reading a stage's scoring the way the engine applies it. Pure and client-safe.
 */
import type { ForfeitScoring, Scoring } from './types';

/**
 * The points of a forfeit or no-show, or `null` when the stage does not score forfeits separately (then a forfeit
 * scores like a played match: win and loss points, no faint tally). The number shorthand gives the winner that
 * number and the loser the stage's `loss`, without the faint bonus.
 */
export function forfeitScoringOf(scoring: Scoring): ForfeitScoring | null {
  const forfeit = scoring.forfeit;
  if (forfeit === undefined) return null;
  if (typeof forfeit === 'number') return { win: forfeit, loss: scoring.loss, faint_bonus: false };
  return forfeit;
}

/** Points per fainted Pokémon of the opponent; an absent field is 0. */
export function perOpponentFaintOf(scoring: Scoring): number {
  return scoring.per_opponent_faint ?? 0;
}
