import { describe, it, expect } from 'vitest';
import {
  generateSingleElimRound1,
  generateSingleElimNextRound,
  getSingleElimTotalRounds,
} from '../single-elim';
import type { MatchRecord } from '../types';

describe('generateSingleElimRound1', () => {
  it('pairs power-of-2 players with no byes', () => {
    const round = generateSingleElimRound1(['p1', 'p2', 'p3', 'p4']);
    expect(round.pairings).toHaveLength(2);
    expect(round.bye_player_ids).toHaveLength(0);
    expect(round.round_number).toBe(1);
  });

  it('gives byes for non-power-of-2', () => {
    const round = generateSingleElimRound1(['p1', 'p2', 'p3']);
    // Bracket size 4 → 2 matches, but only 3 players → 1 bye
    const totalAccountedFor =
      round.pairings.length * 2 + round.bye_player_ids.length;
    expect(totalAccountedFor).toBe(3);
    expect(round.bye_player_ids.length).toBeGreaterThan(0);
  });

  it('handles 8 players as quarterfinals', () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
    const round = generateSingleElimRound1(players);
    expect(round.pairings).toHaveLength(4);
    expect(round.round_name).toBe('Quarterfinals');
  });

  it('names finals correctly for 2 players', () => {
    const round = generateSingleElimRound1(['p1', 'p2']);
    expect(round.round_name).toBe('Finals');
  });

  it('places seeds 1 and 2 on opposite sides of the bracket', () => {
    // With 8 players, bracket order is [1,8,4,5,3,6,2,7]
    // Pairs: (1v8), (4v5), (3v6), (2v7)
    // Top half: (1v8), (4v5)  Bottom half: (3v6), (2v7)
    // Seeds 1 and 2 can only meet in the Finals
    const players = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const round = generateSingleElimRound1(players);

    // Find which half each top seed is in
    const topHalf = new Set<string>();
    const bottomHalf = new Set<string>();

    // First two pairings = top half, last two = bottom half
    for (let i = 0; i < 2; i++) {
      topHalf.add(round.pairings[i].player_1_id);
      topHalf.add(round.pairings[i].player_2_id);
    }
    for (let i = 2; i < 4; i++) {
      bottomHalf.add(round.pairings[i].player_1_id);
      bottomHalf.add(round.pairings[i].player_2_id);
    }

    // Seed 1 (s1) in top half, seed 2 (s2) in bottom half
    expect(topHalf.has('s1')).toBe(true);
    expect(bottomHalf.has('s2')).toBe(true);
    // They should NOT be in the same half
    expect(topHalf.has('s2')).toBe(false);
    expect(bottomHalf.has('s1')).toBe(false);
  });

  it('gives byes to top seeds with 6 players', () => {
    const players = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const round = generateSingleElimRound1(players);

    // 6 players → bracket size 8 → 2 byes for top 2 seeds
    expect(round.bye_player_ids).toHaveLength(2);
    expect(round.bye_player_ids).toContain('s1');
    expect(round.bye_player_ids).toContain('s2');
    // s1 and s2 should be on opposite halves (bye positions)
    expect(round.pairings).toHaveLength(2);
  });
});

describe('generateSingleElimNextRound', () => {
  it('advances winners from previous round', () => {
    const history: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p4', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p2', player_2_id: 'p3', winner_id: 'p3', round_number: 1 },
    ];
    const round = generateSingleElimNextRound(
      ['p1', 'p2', 'p3', 'p4'],
      history,
      2
    );
    expect(round.pairings).toHaveLength(1);
    expect(round.pairings[0].player_1_id).toBe('p1');
    expect(round.pairings[0].player_2_id).toBe('p3');
  });

  it('advances bye recipients alongside winners', () => {
    // 6 players: s1 and s2 get byes in round 1, others play
    // Round 1 results: s4 beats s5, s3 beats s6
    // Round 2 should have: s1 (bye), s2 (bye), s4 (winner), s3 (winner)
    const players = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const history: MatchRecord[] = [
      { player_1_id: 's4', player_2_id: 's5', winner_id: 's4', round_number: 1 },
      { player_1_id: 's3', player_2_id: 's6', winner_id: 's3', round_number: 1 },
    ];
    const round = generateSingleElimNextRound(players, history, 2);

    // 4 advancing players → 2 matches
    expect(round.pairings).toHaveLength(2);

    // All four advancing players should be present
    const allPlayers = round.pairings.flatMap((p) => [p.player_1_id, p.player_2_id]);
    expect(allPlayers).toContain('s1');
    expect(allPlayers).toContain('s2');
    expect(allPlayers).toContain('s3');
    expect(allPlayers).toContain('s4');

    // Eliminated players should NOT be present
    expect(allPlayers).not.toContain('s5');
    expect(allPlayers).not.toContain('s6');
  });
});

describe('getSingleElimTotalRounds', () => {
  it('returns correct round counts', () => {
    expect(getSingleElimTotalRounds(2)).toBe(1);
    expect(getSingleElimTotalRounds(4)).toBe(2);
    expect(getSingleElimTotalRounds(8)).toBe(3);
    expect(getSingleElimTotalRounds(16)).toBe(4);
    // Non-power-of-2: ceil(log2(5)) = 3
    expect(getSingleElimTotalRounds(5)).toBe(3);
  });
});
