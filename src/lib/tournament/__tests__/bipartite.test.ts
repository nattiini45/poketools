import { describe, expect, it } from 'vitest';
import { generateBipartiteRound } from '../bipartite';
import { BYE_PLAYER_ID } from '../types';

const key = (p: { player_1_id: string; player_2_id: string }) => `${p.player_1_id}-${p.player_2_id}`;
const record = (p1: string, p2: string, round: number) => ({ player_1_id: p1, player_2_id: p2, winner_id: p1, round_number: round });

describe('generateBipartiteRound', () => {
  it('pairs the nearest ranks across the sides, side A as player 1', () => {
    const round = generateBipartiteRound(['a1', 'a2'], ['b1', 'b2'], [], 1, [], { ranked: ['a1', 'b1', 'a2', 'b2'] });
    expect(round.pairings.map(key).sort()).toEqual(['a1-b1', 'a2-b2']);
    expect(round.bye_player_ids).toEqual([]);
  });

  it('never pairs two players of one side', () => {
    const round = generateBipartiteRound(['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], [], 1, [], { ranked: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'] });
    for (const p of round.pairings) {
      expect(p.player_1_id.startsWith('a')).toBe(true);
      expect(p.player_2_id.startsWith('b')).toBe(true);
    }
  });

  it('avoids a rematch when another pairing exists', () => {
    const history = [record('a1', 'b1', 1), record('a2', 'b2', 1)];
    const round = generateBipartiteRound(['a1', 'a2'], ['b1', 'b2'], history, 2, [], { ranked: ['a1', 'b1', 'a2', 'b2'] });
    expect(round.rematches).toBe(0);
    expect(round.pairings.map(key).sort()).toEqual(['a1-b2', 'a2-b1']);
  });

  it('repeats a pairing, and says so, when every pairing is a rematch', () => {
    const history = [record('a1', 'b1', 1), record('a1', 'b2', 2), record('a2', 'b1', 2), record('a2', 'b2', 1)];
    const round = generateBipartiteRound(['a1', 'a2'], ['b1', 'b2'], history, 3, [], { ranked: ['a1', 'b1', 'a2', 'b2'] });
    expect(round.rematches).toBe(2);
    expect(round.pairings).toHaveLength(2);
  });

  it('gives the surplus of the larger side a bye, the lowest-ranked first', () => {
    const round = generateBipartiteRound(['a1', 'a2', 'a3'], ['b1', 'b2'], [], 1, [], { ranked: ['a1', 'a2', 'a3', 'b1', 'b2'] });
    expect(round.bye_player_ids).toEqual(['a3']);
    expect(round.pairings).toHaveLength(2);
  });

  it('skips a player who already had a bye', () => {
    const round = generateBipartiteRound(['a1', 'a2', 'a3'], ['b1', 'b2'], [], 2, [{ player_id: 'a3', round_number: 1 }] as never, {
      ranked: ['a1', 'a2', 'a3', 'b1', 'b2'],
    });
    expect(round.bye_player_ids).toEqual(['a2']);
    expect(BYE_PLAYER_ID).toBeTruthy();
  });

  it('pairs nobody and gives no bye when a side is empty', () => {
    const round = generateBipartiteRound(['a1', 'a2'], [], [], 1, [], { ranked: ['a1', 'a2'] });
    expect(round.pairings).toEqual([]);
    expect(round.bye_player_ids).toEqual([]);
  });
});
