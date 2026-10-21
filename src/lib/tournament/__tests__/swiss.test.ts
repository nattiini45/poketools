import { describe, it, expect } from 'vitest';
import { generateSwissRound } from '../swiss';
import type { MatchRecord } from '../types';
import { BYE_PLAYER_ID } from '../types';

const names: Record<string, string> = {
  p1: 'Player 1',
  p2: 'Player 2',
  p3: 'Player 3',
  p4: 'Player 4',
  p5: 'Player 5',
};

describe('generateSwissRound', () => {
  it('pairs all players in round 1 with no history', () => {
    const round = generateSwissRound(['p1', 'p2', 'p3', 'p4'], names, [], 1);
    expect(round.pairings).toHaveLength(2);
    expect(round.bye_player_ids).toHaveLength(0);
    expect(round.round_number).toBe(1);
    expect(round.round_name).toBe('Round 1');
  });

  it('gives a bye for odd player count', () => {
    const round = generateSwissRound(['p1', 'p2', 'p3'], names, [], 1);
    expect(round.pairings).toHaveLength(1);
    expect(round.bye_player_ids).toHaveLength(1);
  });

  it('avoids re-pairing players who already met', () => {
    const history: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p3', player_2_id: 'p4', winner_id: 'p3', round_number: 1 },
    ];
    const round = generateSwissRound(['p1', 'p2', 'p3', 'p4'], names, history, 2);
    // p1 should NOT be paired with p2 again
    for (const pairing of round.pairings) {
      const pair = [pairing.player_1_id, pairing.player_2_id].sort();
      expect(pair).not.toEqual(['p1', 'p2']);
      expect(pair).not.toEqual(['p3', 'p4']);
    }
  });

  it('falls back to re-pairing when all opponents exhausted', () => {
    // Only 2 players: they must re-pair
    const history: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ];
    const round = generateSwissRound(['p1', 'p2'], names, history, 2);
    expect(round.pairings).toHaveLength(1);
  });

  it('prefers bye to player who hasn\'t had one yet', () => {
    // p3 already had a bye (played against BYE)
    const history: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p3', player_2_id: BYE_PLAYER_ID, winner_id: 'p3', round_number: 1 },
    ];
    const round = generateSwissRound(['p1', 'p2', 'p3'], names, history, 2);
    // p3 already had bye, so bye should go to p1 or p2
    expect(round.bye_player_ids).toHaveLength(1);
    expect(round.bye_player_ids[0]).not.toBe('p3');
  });

  it('handles 5 players with proper pairings and bye', () => {
    const round = generateSwissRound(['p1', 'p2', 'p3', 'p4', 'p5'], names, [], 1);
    expect(round.pairings).toHaveLength(2);
    expect(round.bye_player_ids).toHaveLength(1);
    // Total accounted for: 2*2 + 1 = 5
    const allPlayers = new Set<string>();
    for (const p of round.pairings) {
      allPlayers.add(p.player_1_id);
      allPlayers.add(p.player_2_id);
    }
    for (const b of round.bye_player_ids) {
      allPlayers.add(b);
    }
    expect(allPlayers.size).toBe(5);
  });
});
