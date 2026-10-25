import { describe, expect, it } from 'vitest';
import { computeEvolutionPointBuyStandings } from '../evolution-standings';
import { resolveHeadToHead } from '../head-to-head';
import type { MatchRecord } from '../types';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import { epbPack } from '@/lib/format-pack';

function makeMatch(
  p1: string,
  p2: string,
  winner: string | null,
  round = 1
): MatchRecord {
  return {
    id: `${p1}-${p2}-${round}`,
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    round_number: round,
    status: 'completed',
  } as MatchRecord;
}

describe('resolveHeadToHead', () => {
  const matches = [
    makeMatch('A', 'B', 'A'),
    makeMatch('A', 'B', 'A', 2),
    makeMatch('A', 'C', 'C'),
  ];

  it('returns 1 if playerA won more direct matches', () => {
    expect(resolveHeadToHead('A', 'B', matches)).toBe(1);
  });

  it('returns -1 if playerB won more direct matches', () => {
    expect(resolveHeadToHead('B', 'A', matches)).toBe(-1);
  });

  it('returns 0 for no direct matches', () => {
    expect(resolveHeadToHead('B', 'C', matches)).toBe(0);
  });

  it('returns 0 for tied direct matches', () => {
    const tied = [makeMatch('A', 'B', 'A'), makeMatch('A', 'B', 'B', 2)];
    expect(resolveHeadToHead('A', 'B', tied)).toBe(0);
  });
});

describe('computeEvolutionPointBuyStandings', () => {
  const names = { A: 'Player A', B: 'Player B', C: 'Player C' };

  it('sorts by match points first', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('A', 'C', 'A'),
      makeMatch('B', 'C', 'B'),
    ];
    const evoPoints = { A: 0, B: 0, C: 0 };
    const result = computeEvolutionPointBuyStandings(
      ['A', 'B', 'C'], names, matches, evoPoints
    );
    expect(result[0].player_id).toBe('A'); // 6 pts
    expect(result[1].player_id).toBe('B'); // 3 pts
    expect(result[2].player_id).toBe('C'); // 0 pts
  });

  it('uses evolution points as second tiebreaker', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('A', 'C', 'C'),
      makeMatch('B', 'C', 'B'),
    ];
    // A and B both have 3 pts, but B has more evo points
    const evoPoints = { A: 1, B: 3, C: 3 };
    const result = computeEvolutionPointBuyStandings(
      ['A', 'B', 'C'], names, matches, evoPoints
    );
    // B has 3 match pts + 3 evo pts, C has 3 match pts + 3 evo pts
    // A has 3 match pts + 1 evo pt → A is last among the 3-pt group
    expect(result[2].player_id).toBe('A');
  });

  it('flags decision match for complete ties', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('A', 'B', 'B', 2),
    ];
    const evoPoints = { A: 2, B: 2 };
    const result = computeEvolutionPointBuyStandings(
      ['A', 'B'], names, matches, evoPoints
    );
    // Both have 3 pts, 2 evo pts, 0 kill diff, tied h2h
    expect(result[0].needs_decision_match).toBe(true);
    expect(result[1].needs_decision_match).toBe(true);
  });

  it('uses the pack match points by default (win and draw)', () => {
    const result = computeEvolutionPointBuyStandings(
      ['A', 'B', 'C'], names, [makeMatch('A', 'B', 'A'), makeMatch('B', 'C', null, 2)], {}
    );
    const pts = Object.fromEntries(result.map((r) => [r.player_id, r.points]));
    expect(pts).toEqual({
      A: epbPack.matchPoints.win,
      B: epbPack.matchPoints.draw,
      C: epbPack.matchPoints.draw,
    });
  });

  it('follows the pack tiebreaker order between kill difference and evolution points', () => {
    // A and B tie on match points; A leads on evolution points, B on kill difference.
    const matches = [makeMatch('A', 'C', 'A'), makeMatch('B', 'C', 'B', 2)];
    const battleStats = [
      { player_id: 'B', kos_dealt: 3, was_koed: false },
    ] as unknown as TournamentBattleStat[];
    const result = computeEvolutionPointBuyStandings(
      ['A', 'B', 'C'], names, matches, { A: 2, B: 0, C: 0 }, {}, { battleStats }
    );
    const chain = epbPack.tiebreakerChain;
    const killFirst = chain.indexOf('kill_difference') < chain.indexOf('evolution_points');
    expect(result[0].player_id).toBe(killFirst ? 'B' : 'A');
    // example pack: kill difference comes before evolution points
    expect(killFirst).toBe(true);
  });

  describe('stored tiebreaker order', () => {
    // A and B tie on match points (4 each: a win over C and a draw between them); A leads on evolution points
    // (2 v 0), B on kill difference (+3 v 0).
    const tieMatches = [makeMatch('A', 'C', 'A'), makeMatch('B', 'C', 'B', 2), makeMatch('A', 'B', null, 3)];
    const battleStats = [{ player_id: 'B', kos_dealt: 3, was_koed: false }] as unknown as TournamentBattleStat[];
    const ids = ['A', 'B', 'C'];
    const evo = { A: 2, B: 0, C: 0 };
    const rank = (tiebreakerOrder?: unknown) =>
      computeEvolutionPointBuyStandings(ids, names, tieMatches, evo, {}, { battleStats, tiebreakerOrder }).map(
        (r) => r.player_id,
      );

    it('ranks by the stored order: evolution points first puts A ahead, kill difference first puts B ahead', () => {
      expect(rank(['match_points', 'evolution_points', 'kill_difference'])[0]).toBe('A');
      expect(rank(['match_points', 'kill_difference', 'evolution_points'])[0]).toBe('B');
    });

    it('a stored order reverses the pack outcome (the example pack puts kill difference first)', () => {
      expect(rank()[0]).toBe('B');
      expect(rank(['match_points', 'evolution_points'])[0]).toBe('A');
    });

    it('a step the stored order leaves out is not compared', () => {
      // No kill difference step: B's +3 never counts, and the A/B tie falls to the input order.
      const withoutKills = rank(['match_points']);
      expect(withoutKills.slice(0, 2)).toEqual(['A', 'B']);
      expect(withoutKills[2]).toBe('C');
    });

    it('ranks by a stored order that starts below match points', () => {
      // Evolution points alone: A (2) first, then B and C tied at 0 in input order.
      expect(rank(['evolution_points'])).toEqual(['A', 'B', 'C']);
    });

    it.each([
      ['empty', []],
      ['an unknown step', ['match_points', 'coin_flip']],
      ['a repeated step', ['match_points', 'match_points']],
      ['a misplaced decision match', ['decision_match', 'match_points']],
      ['not a list', 'match_points'],
      ['null', null],
    ])('falls back to the pack chain when the stored order is %s', (_label, stored) => {
      expect(rank(stored)).toEqual(rank());
    });

    it('flags a decision match only when the effective chain ends in one', () => {
      const tied = [makeMatch('A', 'B', 'A'), makeMatch('A', 'B', 'B', 2)];
      const flagged = (order?: unknown) =>
        computeEvolutionPointBuyStandings(['A', 'B'], names, tied, { A: 2, B: 2 }, {}, { tiebreakerOrder: order }).map(
          (r) => r.needs_decision_match,
        );
      expect(flagged(['match_points', 'head_to_head', 'decision_match'])).toEqual([true, true]);
      expect(flagged(['match_points', 'head_to_head'])).toEqual([false, false]);
    });

    it('scores the pack match points even when a caller passes its own', () => {
      const wins = computeEvolutionPointBuyStandings(
        ['A', 'B'], names, [makeMatch('A', 'B', 'A')], {}, {}, { tiebreakerOrder: ['match_points'] },
      );
      expect(wins[0].points).toBe(epbPack.matchPoints.win);
    });
  });
});
