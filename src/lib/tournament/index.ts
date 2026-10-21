import type { BracketType } from '@/types/tournament';
import type { GeneratedRound, MatchRecord } from './types';
import { generateSwissRound } from './swiss';
import { generateRoundRobinRound } from './round-robin';
import {
  generateSingleElimRound1,
  generateSingleElimNextRound,
} from './single-elim';
import {
  generateDoubleElimRound,
  type StartingBrackets,
} from './double-elim';

export interface GenerateRoundOptions {
  /** LB-start map for double elimination (ignored by other bracket types). */
  startingBrackets?: StartingBrackets;
}

/**
 * Generate the next round of pairings for a tournament.
 * Dispatches to the appropriate bracket-type algorithm.
 */
export function generateRound(
  bracketType: BracketType,
  participantIds: string[],
  participantNames: Record<string, string>,
  matchHistory: MatchRecord[],
  roundNumber: number,
  options?: GenerateRoundOptions
): GeneratedRound {
  switch (bracketType) {
    case 'swiss':
      return generateSwissRound(
        participantIds,
        participantNames,
        matchHistory,
        roundNumber
      );

    case 'round_robin':
      return generateRoundRobinRound(participantIds, roundNumber);

    case 'single_elim':
      if (roundNumber === 1) {
        return generateSingleElimRound1(participantIds);
      }
      return generateSingleElimNextRound(
        participantIds,
        matchHistory,
        roundNumber
      );

    case 'double_elim':
      return generateDoubleElimRound(
        participantIds,
        matchHistory,
        roundNumber,
        options?.startingBrackets
      );

    default: {
      const _exhaustive: never = bracketType;
      throw new Error(`Unknown bracket type: ${_exhaustive}`);
    }
  }
}
