/**
 * The series tally an admin checks before completing or disputing a match:
 * how many games each player won, whether the best-of threshold is reached,
 * and which warnings a chosen winner earns against the recorded games. Pure
 * and client-safe, so the confirmation dialog and its tests need no DOM.
 */
import { hasReachedBoThreshold } from '@/lib/tournament/match-state';

export interface SeriesTally {
  player1Wins: number;
  player2Wins: number;
  /** Games recorded for the match, with or without a winner. */
  recorded: number;
  /** Recorded games without a winner (or with a winner outside the two players). */
  undecidedGames: number;
  /** The round's best-of, or null when it is unknown. */
  bestOf: number | null;
  /** Game wins that decide the series, or null when the best-of is unknown. */
  winsNeeded: number | null;
  /** Some player has the wins the best-of needs. Always false when the best-of is unknown. */
  reached: boolean;
  /** The player the games favour; null for tied games or no wins. */
  leaderId: string | null;
}

export type ResultWarning =
  | { kind: 'noGames' }
  | { kind: 'undecidedGames'; count: number }
  | { kind: 'belowThreshold'; bestOf: number; winsNeeded: number }
  | { kind: 'contradicts'; leaderId: string; chosenId: string };

export function computeSeriesTally(
  games: ReadonlyArray<{ winner_id: string | null }>,
  player1Id: string,
  player2Id: string,
  bestOf: number | null,
): SeriesTally {
  let player1Wins = 0;
  let player2Wins = 0;
  for (const game of games) {
    if (game.winner_id === player1Id) player1Wins += 1;
    else if (game.winner_id === player2Id) player2Wins += 1;
  }
  const knownBestOf = bestOf !== null && Number.isFinite(bestOf) && bestOf >= 1 ? bestOf : null;
  const winsNeeded = knownBestOf === null ? null : Math.ceil(knownBestOf / 2);
  const reached = knownBestOf === null ? false : hasReachedBoThreshold(knownBestOf, player1Wins, player2Wins).reached;
  let leaderId: string | null = null;
  if (player1Wins > player2Wins) leaderId = player1Id;
  else if (player2Wins > player1Wins) leaderId = player2Id;

  return {
    player1Wins,
    player2Wins,
    recorded: games.length,
    undecidedGames: games.length - player1Wins - player2Wins,
    bestOf: knownBestOf,
    winsNeeded,
    reached,
    leaderId,
  };
}

/** What is odd about completing the match for `chosenWinnerId`, given the recorded games. */
export function completionWarnings(tally: SeriesTally, chosenWinnerId: string): ResultWarning[] {
  if (tally.recorded === 0) return [{ kind: 'noGames' }];
  const warnings: ResultWarning[] = [];
  if (tally.undecidedGames > 0) warnings.push({ kind: 'undecidedGames', count: tally.undecidedGames });
  if (tally.bestOf !== null && tally.winsNeeded !== null && !tally.reached) {
    warnings.push({ kind: 'belowThreshold', bestOf: tally.bestOf, winsNeeded: tally.winsNeeded });
  }
  if (tally.leaderId !== null && tally.leaderId !== chosenWinnerId) {
    warnings.push({ kind: 'contradicts', leaderId: tally.leaderId, chosenId: chosenWinnerId });
  }
  return warnings;
}
