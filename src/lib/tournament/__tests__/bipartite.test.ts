import { describe, expect, it } from 'vitest';
import { buildBipartiteSchedule, generateBipartiteRound } from '../bipartite';
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

  it('lets the schedule decide who sits out, one round after the other', () => {
    const sides = [['a1', 'a2', 'a3'], ['b1', 'b2']] as const;
    const sat = [1, 2, 3].map(
      (n) => generateBipartiteRound(sides[0], sides[1], [], n, [], { ranked: ['a1', 'a2', 'a3', 'b1', 'b2'] }).bye_player_ids,
    );
    expect(sat).toEqual([['a3'], ['a1'], ['a2']]);
    expect(BYE_PLAYER_ID).toBeTruthy();
  });

  it('pairs nobody and gives no bye when a side is empty', () => {
    const round = generateBipartiteRound(['a1', 'a2'], [], [], 1, [], { ranked: ['a1', 'a2'] });
    expect(round.pairings).toEqual([]);
    expect(round.bye_player_ids).toEqual([]);
  });

  it('is deterministic', () => {
    const args = [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3', 'b4'], [], 2, [], { ranked: ['b4', 'a2', 'b1', 'a3', 'b2', 'a1', 'b3'] }] as const;
    const first = generateBipartiteRound(...(args as unknown as Parameters<typeof generateBipartiteRound>));
    const second = generateBipartiteRound(...(args as unknown as Parameters<typeof generateBipartiteRound>));
    expect(second).toEqual(first);
  });
});

describe('buildBipartiteSchedule', () => {
  const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

  it.each([
    [1, 1],
    [1, 4],
    [4, 1],
    [2, 5],
    [5, 2],
    [3, 3],
    [4, 6],
    [6, 4],
    [7, 7],
    [3, 8],
  ])('meets every A with every B exactly once for %i x %i', (na, nb) => {
    const a = names('a', na);
    const b = names('b', nb);
    const schedule = buildBipartiteSchedule(a, b);
    expect(schedule).toHaveLength(Math.max(na, nb));
    const seen = new Map<string, number>();
    for (const round of schedule) {
      expect(round.pairs).toHaveLength(Math.min(na, nb));
      const playing = new Set<string>();
      for (const [x, y] of round.pairs) {
        expect(x.startsWith('a') && y.startsWith('b')).toBe(true);
        expect(playing.has(x) || playing.has(y)).toBe(false);
        playing.add(x).add(y);
        seen.set(`${x}-${y}`, (seen.get(`${x}-${y}`) ?? 0) + 1);
      }
      expect(new Set([...playing, ...round.sitting]).size).toBe(na + nb);
      expect(round.sitting).toHaveLength(Math.abs(na - nb));
    }
    expect(seen.size).toBe(na * nb);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it('gives each player of the larger side the same number of byes', () => {
    const schedule = buildBipartiteSchedule(names('a', 3), names('b', 7));
    const byes = new Map<string, number>();
    for (const round of schedule) for (const id of round.sitting) byes.set(id, (byes.get(id) ?? 0) + 1);
    expect(new Set(byes.values())).toEqual(new Set([4]));
    expect(byes.size).toBe(7);
  });

  it('is empty when a side is empty and drops duplicate players', () => {
    expect(buildBipartiteSchedule([], ['b1'])).toEqual([]);
    expect(buildBipartiteSchedule(['a1', 'a1'], ['b1'])).toHaveLength(1);
  });
});

describe('generateBipartiteRound over a whole stage', () => {
  const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

  // Plays every round of the stage, each with different standings, and returns every pairing played.
  function playStage(a: string[], b: string[], rounds: number) {
    const played: Array<{ player_1_id: string; player_2_id: string; winner_id: string; round_number: number }> = [];
    const results = [];
    for (let n = 1; n <= rounds; n += 1) {
      // Standings move every round: rotate and reverse the ranked list.
      const all = [...a, ...b];
      const ranked = [...all.slice(n % all.length), ...all.slice(0, n % all.length)];
      if (n % 2 === 0) ranked.reverse();
      const round = generateBipartiteRound(a, b, played, n, [], { ranked });
      results.push(round);
      for (const p of round.pairings) played.push({ player_1_id: p.player_1_id, player_2_id: p.player_2_id, winner_id: p.player_1_id, round_number: n });
    }
    return { played, results };
  }

  it.each([
    [4, 4],
    [3, 7],
    [6, 2],
    [5, 5],
    [1, 6],
  ])('every A meets every B once and nobody is re-paired for %i x %i, whatever the standings', (na, nb) => {
    const a = names('a', na);
    const b = names('b', nb);
    const { played, results } = playStage(a, b, Math.max(na, nb));
    expect(new Set(played.map(key)).size).toBe(na * nb);
    expect(played).toHaveLength(na * nb);
    expect(results.every((r) => r.rematches === 0)).toBe(true);
  });

  it('plays an extra round after the schedule as a flagged rematch', () => {
    const a = names('a', 2);
    const b = names('b', 3);
    const { played } = playStage(a, b, 3);
    const extra = generateBipartiteRound(a, b, played, 4, [], { ranked: [...a, ...b] });
    expect(extra.pairings).toHaveLength(2);
    expect(extra.rematches).toBe(2);
  });

  it('picks the next unplayed schedule round when the nominal one was already paired', () => {
    // Round 1 of the schedule (a1-b1, a2-b2) already exists, so round 2 must not repeat it.
    const history = [record('a1', 'b1', 1), record('a2', 'b2', 1)];
    const round = generateBipartiteRound(['a1', 'a2'], ['b1', 'b2'], history, 1, [], { ranked: ['a1', 'b1', 'a2', 'b2'] });
    expect(round.pairings.map(key).sort()).toEqual(['a1-b2', 'a2-b1']);
    expect(round.rematches).toBe(0);
  });

  it('cycles the schedule when repeats are allowed (empty pairing history)', () => {
    const history = [record('a1', 'b1', 1), record('a2', 'b2', 1)];
    const round = generateBipartiteRound(['a1', 'a2'], ['b1', 'b2'], history, 3, [], { ranked: ['a1', 'b1', 'a2', 'b2'], pairedMatches: [] });
    expect(round.pairings.map(key).sort()).toEqual(['a1-b1', 'a2-b2']);
  });
});
