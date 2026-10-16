import { describe, it, expect } from 'vitest';
import { computeBracketState, generateDoubleElimRound } from '../double-elim';
import type { MatchRecord } from '../types';

describe('computeBracketState', () => {
  it('puts everyone in winners bracket with no history', () => {
    const state = computeBracketState(['a', 'b', 'c', 'd'], []);
    expect(state.winners_bracket).toEqual(['a', 'b', 'c', 'd']);
    expect(state.losers_bracket).toHaveLength(0);
    expect(state.eliminated).toHaveLength(0);
  });

  it('moves losers to losers bracket after one loss', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    ];
    const state = computeBracketState(['a', 'b', 'c', 'd'], matches);
    expect(state.winners_bracket).toContain('a');
    expect(state.losers_bracket).toContain('b');
  });

  it('eliminates players after two losses', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'b', player_2_id: 'c', winner_id: 'c', round_number: 2 },
    ];
    const state = computeBracketState(['a', 'b', 'c'], matches);
    expect(state.eliminated).toContain('b');
    expect(state.winners_bracket).toContain('a');
    expect(state.winners_bracket).toContain('c');
  });
});

describe('generateDoubleElimRound', () => {
  it('generates initial pairings for round 1', () => {
    const round = generateDoubleElimRound(['a', 'b', 'c', 'd'], [], 1);
    expect(round.pairings).toHaveLength(2);
  });

  it('generates grand finals when 1 winner + 1 loser remain', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'a', round_number: 2 },
      { player_1_id: 'b', player_2_id: 'd', winner_id: 'b', round_number: 2 },
      { player_1_id: 'c', player_2_id: 'b', winner_id: 'c', round_number: 3 },
    ];
    const round = generateDoubleElimRound(['a', 'b', 'c', 'd'], matches, 4);
    expect(round.round_name).toBe('Grand Finals');
    expect(round.pairings).toHaveLength(1);
    expect(round.pairings[0].player_1_id).toBe('a');
    expect(round.pairings[0].player_2_id).toBe('c');
  });

  it('handles odd winners bracket with bye', () => {
    // 3 players, no history: 1 player gets bye in winners
    const round = generateDoubleElimRound(['a', 'b', 'c'], [], 1);
    expect(round.pairings).toHaveLength(1);
    expect(round.bye_player_ids).toHaveLength(1);
  });

  it('pairs within winners and losers brackets separately', () => {
    // After round 1: a beats b, c beats d, e beats f
    // Winners: a, c, e (3 players) — Losers: b, d, f (3 players)
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
      { player_1_id: 'e', player_2_id: 'f', winner_id: 'e', round_number: 1 },
    ];
    const round = generateDoubleElimRound(
      ['a', 'b', 'c', 'd', 'e', 'f'], matches, 2
    );
    // 3 winners: 1 pair + 1 bye, 3 losers: 1 pair + 1 bye
    expect(round.pairings).toHaveLength(2);
    expect(round.bye_player_ids).toHaveLength(2);
  });

  it('generates losers bracket bye for odd losers count', () => {
    // a beats b — Winners: [a], Losers: [b]
    // Not grand finals because >1 in winners... let's make it so:
    // a beats b, c beats d, e is bye — then a beats c
    // Winners: [a, e], Losers: [b, c, d]
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'a', round_number: 2 },
    ];
    const round = generateDoubleElimRound(
      ['a', 'b', 'c', 'd', 'e'], matches, 3
    );
    // Winners: [a, e] -> 1 pair, Losers: [b, c, d] -> 1 pair + 1 bye
    expect(round.pairings).toHaveLength(2);
    expect(round.bye_player_ids).toHaveLength(1);
  });

  it('names round "Semifinals" when 3-4 active players remain', () => {
    // 4 players, after round 1 two are in winners, two in losers
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
    ];
    const round = generateDoubleElimRound(['a', 'b', 'c', 'd'], matches, 2);
    // totalActive = 2 (winners) + 2 (losers) = 4
    expect(round.round_name).toBe('Semifinals');
  });

  it('names round "Grand Finals" when totalActive is 2 (non-standard path)', () => {
    // 3 players, a beats b, a beats c. Winners: [a], Losers: [b, c]
    // But b and c still have 1 loss each... not grand finals yet.
    // Let's get 2 active: a beats b, c beats d, b beats d (eliminated),
    // then a beats c — Winners: [a], Losers: [b] — that IS grand finals via the standard path.
    // For the totalActive <= 2 round name path (line 131), we need totalActive=2
    // without meeting the grand finals condition (1 winner + 1 loser).
    // E.g., 2 winners + 0 losers:
    const matches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'b', player_2_id: 'c', winner_id: 'c', round_number: 2 },
    ];
    // a: 0 losses (winner), c: 0 losses (winner), b: 2 losses (eliminated)
    const round = generateDoubleElimRound(['a', 'b', 'c'], matches, 3);
    // totalActive = 2 (both in winners), so name = Grand Finals
    expect(round.round_name).toBe('Grand Finals');
  });

  it('labels round 1 as "Winners Round 1"', () => {
    const round = generateDoubleElimRound(['a', 'b', 'c', 'd'], [], 1);
    expect(round.round_name).toBe('Winners Round 1');
  });
});
