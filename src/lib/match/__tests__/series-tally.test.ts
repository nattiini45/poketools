import { describe, expect, it } from 'vitest';
import { completionWarnings, computeSeriesTally } from '@/lib/match/series-tally';

const P1 = 'p1';
const P2 = 'p2';
const won = (id: string | null) => ({ winner_id: id });

describe('computeSeriesTally', () => {
  it('a 2-0 best of 3 is reached with the leader', () => {
    const tally = computeSeriesTally([won(P1), won(P1)], P1, P2, 3);
    expect(tally).toEqual({
      player1Wins: 2,
      player2Wins: 0,
      recorded: 2,
      undecidedGames: 0,
      bestOf: 3,
      winsNeeded: 2,
      reached: true,
      leaderId: P1,
    });
  });

  it('a 1-1 best of 3 is not reached and tied', () => {
    const tally = computeSeriesTally([won(P1), won(P2)], P1, P2, 3);
    expect(tally.reached).toBe(false);
    expect(tally.leaderId).toBeNull();
  });

  it('a best of 1 is decided by one win', () => {
    const tally = computeSeriesTally([won(P2)], P1, P2, 1);
    expect(tally).toMatchObject({ winsNeeded: 1, reached: true, leaderId: P2 });
  });

  it('counts games without a winner as undecided', () => {
    const tally = computeSeriesTally([won(P1), won(null), won('stranger')], P1, P2, 3);
    expect(tally).toMatchObject({ player1Wins: 1, player2Wins: 0, recorded: 3, undecidedGames: 2 });
  });

  it.each([null, 0, -1, Number.NaN])('treats a best of of %s as unknown', (bestOf) => {
    const tally = computeSeriesTally([won(P1), won(P1)], P1, P2, bestOf);
    expect(tally).toMatchObject({ bestOf: null, winsNeeded: null, reached: false, leaderId: P1 });
  });
});

describe('completionWarnings', () => {
  it('has no warning for a consistent 2-0 best of 3', () => {
    const tally = computeSeriesTally([won(P1), won(P1)], P1, P2, 3);
    expect(completionWarnings(tally, P1)).toEqual([]);
  });

  it('warns about a winner the games contradict', () => {
    const tally = computeSeriesTally([won(P1), won(P1)], P1, P2, 3);
    expect(completionWarnings(tally, P2)).toEqual([{ kind: 'contradicts', leaderId: P1, chosenId: P2 }]);
  });

  it('warns about a series below its threshold', () => {
    const tally = computeSeriesTally([won(P1)], P1, P2, 3);
    expect(completionWarnings(tally, P1)).toEqual([{ kind: 'belowThreshold', bestOf: 3, winsNeeded: 2 }]);
  });

  it('reports only noGames when no game is recorded', () => {
    const tally = computeSeriesTally([], P1, P2, 3);
    expect(completionWarnings(tally, P1)).toEqual([{ kind: 'noGames' }]);
  });

  it('counts undecided games', () => {
    const tally = computeSeriesTally([won(P1), won(P1), won(null)], P1, P2, 3);
    expect(completionWarnings(tally, P1)).toEqual([{ kind: 'undecidedGames', count: 1 }]);
  });

  it('has no belowThreshold when the best of is unknown', () => {
    const tally = computeSeriesTally([won(P1)], P1, P2, null);
    expect(completionWarnings(tally, P1)).toEqual([]);
  });

  it('has no contradiction for tied games', () => {
    const tally = computeSeriesTally([won(P1), won(P2)], P1, P2, 3);
    expect(completionWarnings(tally, P1)).toEqual([{ kind: 'belowThreshold', bestOf: 3, winsNeeded: 2 }]);
  });

  it('lists several warnings together', () => {
    const tally = computeSeriesTally([won(P1), won(null)], P1, P2, 3);
    expect(completionWarnings(tally, P2).map((w) => w.kind)).toEqual(['undecidedGames', 'belowThreshold', 'contradicts']);
  });

  it('a best of 1 won by the chosen player is clean', () => {
    const tally = computeSeriesTally([won(P2)], P1, P2, 1);
    expect(completionWarnings(tally, P2)).toEqual([]);
  });
});
