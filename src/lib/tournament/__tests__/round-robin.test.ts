import { describe, it, expect } from 'vitest';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '../round-robin';

describe('generateRoundRobinRound', () => {
  it('generates correct pairings for 4 players round 1', () => {
    const round = generateRoundRobinRound(['a', 'b', 'c', 'd'], 1);
    expect(round.pairings).toHaveLength(2);
    expect(round.bye_player_ids).toHaveLength(0);
    expect(round.round_number).toBe(1);
  });

  it('generates different pairings for different rounds', () => {
    const r1 = generateRoundRobinRound(['a', 'b', 'c', 'd'], 1);
    const r2 = generateRoundRobinRound(['a', 'b', 'c', 'd'], 2);
    // Pairings should differ between rounds
    const r1Key = r1.pairings.map((p) => `${p.player_1_id}-${p.player_2_id}`).sort().join(',');
    const r2Key = r2.pairings.map((p) => `${p.player_1_id}-${p.player_2_id}`).sort().join(',');
    expect(r1Key).not.toBe(r2Key);
  });

  it('every player plays every other player across all rounds', () => {
    const players = ['a', 'b', 'c', 'd'];
    const totalRounds = getRoundRobinTotalRounds(players.length);
    const allPairings = new Set<string>();

    for (let r = 1; r <= totalRounds; r++) {
      const round = generateRoundRobinRound(players, r);
      for (const p of round.pairings) {
        const key = [p.player_1_id, p.player_2_id].sort().join('::');
        allPairings.add(key);
      }
    }

    // 4 players = 6 unique matchups (4 choose 2)
    expect(allPairings.size).toBe(6);
  });

  it('handles odd player count with byes', () => {
    const round = generateRoundRobinRound(['a', 'b', 'c'], 1);
    expect(round.bye_player_ids).toHaveLength(1);
    expect(round.pairings).toHaveLength(1);
  });

  it('throws for invalid round number', () => {
    expect(() => generateRoundRobinRound(['a', 'b', 'c', 'd'], 0)).toThrow();
    expect(() => generateRoundRobinRound(['a', 'b', 'c', 'd'], 4)).toThrow(); // 4 players = 3 rounds max
  });
});

describe('getRoundRobinTotalRounds', () => {
  it('returns n-1 for even player count', () => {
    expect(getRoundRobinTotalRounds(4)).toBe(3);
    expect(getRoundRobinTotalRounds(6)).toBe(5);
    expect(getRoundRobinTotalRounds(8)).toBe(7);
  });

  it('returns n for odd player count (with byes)', () => {
    expect(getRoundRobinTotalRounds(3)).toBe(3);
    expect(getRoundRobinTotalRounds(5)).toBe(5);
    expect(getRoundRobinTotalRounds(7)).toBe(7);
  });
});
