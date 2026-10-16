import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../swiss', () => ({
  generateSwissRound: vi.fn(),
}));

vi.mock('../round-robin', () => ({
  generateRoundRobinRound: vi.fn(),
}));

vi.mock('../single-elim', () => ({
  generateSingleElimRound1: vi.fn(),
  generateSingleElimNextRound: vi.fn(),
}));

vi.mock('../double-elim', () => ({
  generateDoubleElimRound: vi.fn(),
}));

import { generateRound } from '../index';
import { generateSwissRound } from '../swiss';
import { generateRoundRobinRound } from '../round-robin';
import { generateSingleElimRound1, generateSingleElimNextRound } from '../single-elim';
import { generateDoubleElimRound } from '../double-elim';
import type { BracketType } from '@/types/tournament';
import type { GeneratedRound, MatchRecord } from '../types';

const mockSwiss = vi.mocked(generateSwissRound);
const mockRoundRobin = vi.mocked(generateRoundRobinRound);
const mockSingleElimR1 = vi.mocked(generateSingleElimRound1);
const mockSingleElimNext = vi.mocked(generateSingleElimNextRound);
const mockDoubleElim = vi.mocked(generateDoubleElimRound);

const participantIds = ['p1', 'p2', 'p3', 'p4'];
const participantNames: Record<string, string> = {
  p1: 'Alice',
  p2: 'Bob',
  p3: 'Charlie',
  p4: 'Diana',
};
const matchHistory: MatchRecord[] = [];

const dummyRound: GeneratedRound = {
  round_number: 1,
  round_name: 'Round 1',
  pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
  bye_player_ids: [],
};

describe('generateRound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSwiss.mockReturnValue(dummyRound);
    mockRoundRobin.mockReturnValue(dummyRound);
    mockSingleElimR1.mockReturnValue(dummyRound);
    mockSingleElimNext.mockReturnValue(dummyRound);
    mockDoubleElim.mockReturnValue(dummyRound);
  });

  it('dispatches swiss bracket to generateSwissRound', () => {
    generateRound('swiss' as BracketType, participantIds, participantNames, matchHistory, 2);

    expect(mockSwiss).toHaveBeenCalledWith(participantIds, participantNames, matchHistory, 2);
    expect(mockRoundRobin).not.toHaveBeenCalled();
    expect(mockSingleElimR1).not.toHaveBeenCalled();
    expect(mockDoubleElim).not.toHaveBeenCalled();
  });

  it('dispatches round_robin bracket to generateRoundRobinRound', () => {
    generateRound('round_robin' as BracketType, participantIds, participantNames, matchHistory, 1);

    expect(mockRoundRobin).toHaveBeenCalledWith(participantIds, 1);
    expect(mockSwiss).not.toHaveBeenCalled();
  });

  it('dispatches single_elim round 1 to generateSingleElimRound1', () => {
    generateRound('single_elim' as BracketType, participantIds, participantNames, matchHistory, 1);

    expect(mockSingleElimR1).toHaveBeenCalledWith(participantIds);
    expect(mockSingleElimNext).not.toHaveBeenCalled();
  });

  it('dispatches single_elim round > 1 to generateSingleElimNextRound', () => {
    generateRound('single_elim' as BracketType, participantIds, participantNames, matchHistory, 3);

    expect(mockSingleElimNext).toHaveBeenCalledWith(participantIds, matchHistory, 3);
    expect(mockSingleElimR1).not.toHaveBeenCalled();
  });

  it('dispatches double_elim bracket to generateDoubleElimRound', () => {
    generateRound('double_elim' as BracketType, participantIds, participantNames, matchHistory, 2);

    expect(mockDoubleElim).toHaveBeenCalledWith(participantIds, matchHistory, 2, undefined);
  });

  it('threads startingBrackets to generateDoubleElimRound', () => {
    const startingBrackets = { p3: 'losers' as const };

    generateRound(
      'double_elim' as BracketType,
      participantIds,
      participantNames,
      matchHistory,
      1,
      { startingBrackets },
    );

    expect(mockDoubleElim).toHaveBeenCalledWith(
      participantIds,
      matchHistory,
      1,
      startingBrackets,
    );
  });

  it('returns the result from the dispatched function', () => {
    const customRound: GeneratedRound = {
      round_number: 5,
      round_name: 'Round 5',
      pairings: [{ player_1_id: 'p3', player_2_id: 'p4' }],
      bye_player_ids: ['p1'],
    };
    mockSwiss.mockReturnValue(customRound);

    const result = generateRound('swiss' as BracketType, participantIds, participantNames, matchHistory, 5);

    expect(result).toBe(customRound);
  });

  it('throws for unknown bracket type', () => {
    expect(() =>
      generateRound(
        'unknown_bracket' as BracketType,
        participantIds,
        participantNames,
        matchHistory,
        1,
      ),
    ).toThrow('Unknown bracket type: unknown_bracket');
  });
});
