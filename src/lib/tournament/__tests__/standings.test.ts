import { describe, it, expect } from 'vitest';
import { computeStandings, buildPairingHistory, havePlayed } from '../standings';
import type { MatchRecord } from '../types';

const names: Record<string, string> = {
  a: 'Alice',
  b: 'Bob',
  c: 'Charlie',
  d: 'Dana',
};

describe('computeStandings', () => {
  it('returns all participants with zeroes when no matches played', () => {
    const standings = computeStandings(['a', 'b', 'c'], names, []);
    expect(standings).toHaveLength(3);
    for (const s of standings) {
      expect(s.wins).toBe(0);
      expect(s.losses).toBe(0);
      expect(s.points).toBe(0);
    }
  });

  it('tallies wins and losses correctly', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'a', winner_id: 'a', round_number: 1 },
    ];
    const standings = computeStandings(['a', 'b', 'c'], names, matches);
    const alice = standings.find((s) => s.player_id === 'a')!;
    expect(alice.wins).toBe(2);
    expect(alice.losses).toBe(0);
    expect(alice.points).toBe(2);
  });

  it('handles draws (null winner)', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: null, round_number: 1 },
    ];
    const standings = computeStandings(['a', 'b'], names, matches);
    const alice = standings.find((s) => s.player_id === 'a')!;
    const bob = standings.find((s) => s.player_id === 'b')!;
    expect(alice.draws).toBe(1);
    expect(alice.points).toBe(0.5);
    expect(bob.draws).toBe(1);
    expect(bob.points).toBe(0.5);
  });

  it('sorts by points desc, then buchholz desc', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'a', round_number: 2 },
      { player_1_id: 'b', player_2_id: 'd', winner_id: 'b', round_number: 2 },
    ];
    const standings = computeStandings(['a', 'b', 'c', 'd'], names, matches);
    // Alice has 2 wins (2 pts), C and B have 1 win each, D has 0
    expect(standings[0].player_id).toBe('a');
    expect(standings[standings.length - 1].player_id).toBe('d');
  });

  it('computes buchholz tiebreaker (sum of opponents points)', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
    ];
    const standings = computeStandings(['a', 'b', 'c', 'd'], names, matches);
    const alice = standings.find((s) => s.player_id === 'a')!;
    // Alice's buchholz = Bob's points (0)
    expect(alice.buchholz).toBe(0);
  });

  it('uses "Unknown" for missing player names', () => {
    const standings = computeStandings(['x'], {}, []);
    expect(standings[0].player_name).toBe('Unknown');
  });

  it('computes games_played from gamesByMatch option', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    ];
    const gamesByMatch: Record<string, string[]> = {
      'a::b': ['winner-1', 'winner-2', 'winner-3'],
    };
    const standings = computeStandings(['a', 'b'], names, matches, {}, { gamesByMatch });
    const alice = standings.find((s) => s.player_id === 'a')!;
    const bob = standings.find((s) => s.player_id === 'b')!;
    expect(alice.games_played).toBe(3);
    expect(bob.games_played).toBe(3);
  });

  it('leaves games_played at 0 when gamesByMatch key does not match', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    ];
    const gamesByMatch: Record<string, string[]> = {
      'x::y': ['g1'],
    };
    const standings = computeStandings(['a', 'b'], names, matches, {}, { gamesByMatch });
    const alice = standings.find((s) => s.player_id === 'a')!;
    expect(alice.games_played).toBe(0);
  });

  it('computes kill_differential from battleStats', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    ];
    const battleStats = [
      { player_id: 'a', kos_dealt: 3, was_koed: false, round_number: 1 } as never,
      { player_id: 'a', kos_dealt: 1, was_koed: true, round_number: 1 } as never,
      { player_id: 'b', kos_dealt: 1, was_koed: true, round_number: 1 } as never,
    ];
    const standings = computeStandings(['a', 'b'], names, matches, {}, { battleStats });
    const alice = standings.find((s) => s.player_id === 'a')!;
    const bob = standings.find((s) => s.player_id === 'b')!;
    // Alice: +3 -1 = +2 KOs, then +1 -1 = 0 -> total = 3
    expect(alice.kill_differential).toBe(3); // 3+1 kos_dealt - 1 was_koed = 3
    expect(bob.kill_differential).toBe(0); // 1 kos_dealt - 1 was_koed = 0
  });

  it('filters battleStats by maxRound', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'a', round_number: 2 },
    ];
    const battleStats = [
      { player_id: 'a', kos_dealt: 2, was_koed: false, round_number: 1 } as never,
      { player_id: 'a', kos_dealt: 5, was_koed: false, round_number: 2 } as never,
    ];
    const standings = computeStandings(
      ['a', 'b', 'c'], names, matches, {},
      { battleStats, maxRound: 1 }
    );
    const alice = standings.find((s) => s.player_id === 'a')!;
    // Only round 1 included: 2 kos, 0 deaths
    expect(alice.kill_differential).toBe(2);
    // Only round 1 match counted
    expect(alice.wins).toBe(1);
  });

  it('sorts by kill_differential as tiebreaker', () => {
    // Both players have 1 win (1 point each), but different kill differentials
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'a', round_number: 1 },
      { player_1_id: 'b', player_2_id: 'd', winner_id: 'b', round_number: 1 },
    ];
    const battleStats = [
      { player_id: 'a', kos_dealt: 5, was_koed: false, round_number: 1 } as never,
      { player_id: 'b', kos_dealt: 1, was_koed: false, round_number: 1 } as never,
    ];
    const standings = computeStandings(
      ['a', 'b', 'c', 'd'], names, matches, {},
      { battleStats }
    );
    // Both a and b have 1 win. a has higher kill_differential (5 vs 1)
    const topTwo = standings.slice(0, 2);
    expect(topTwo[0].player_id).toBe('a');
    expect(topTwo[1].player_id).toBe('b');
  });

  it('uses custom pointsPerWin and pointsPerDraw', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: null, round_number: 1 },
    ];
    const standings = computeStandings(
      ['a', 'b', 'c', 'd'], names, matches, {},
      { pointsPerWin: 3, pointsPerDraw: 0 }
    );
    const alice = standings.find((s) => s.player_id === 'a')!;
    const charlie = standings.find((s) => s.player_id === 'c')!;
    expect(alice.points).toBe(3);
    expect(charlie.points).toBe(0);
    expect(charlie.draws).toBe(1);
  });
});

describe('buildPairingHistory', () => {
  it('creates order-independent pairing keys', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'b', player_2_id: 'a', winner_id: 'a', round_number: 1 },
    ];
    const history = buildPairingHistory(matches);
    // Should contain the sorted key "a::b"
    expect(history.has('a::b')).toBe(true);
  });
});

describe('havePlayed', () => {
  it('returns true for previous opponents regardless of order', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    ];
    const history = buildPairingHistory(matches);
    expect(havePlayed(history, 'a', 'b')).toBe(true);
    expect(havePlayed(history, 'b', 'a')).toBe(true);
  });

  it('returns false for players who have not met', () => {
    const history = buildPairingHistory([]);
    expect(havePlayed(history, 'a', 'b')).toBe(false);
  });
});
