import { describe, it, expect } from 'vitest';
import { generateSwissRound } from '../swiss';
import { computeStandings } from '../standings';
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

// ─── #39: no avoidable rematch ───────────────────────────────────────────────

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Whether some bye choice and perfect matching of `players` avoids every pair in `met` (brute force). Bye candidates:
 * players without a prior bye, or all of them once everyone has had one (the engine's own rule).
 */
function rematchFreeExists(players: string[], met: Set<string>, hadBye: Set<string>): boolean {
  const pairUp = (rest: string[]): boolean => {
    if (rest.length === 0) return true;
    const [first, ...others] = rest;
    return others.some((other, index) => !met.has(pairKey(first, other)) && pairUp(others.filter((_, i) => i !== index)));
  };
  if (players.length % 2 === 0) return pairUp(players);
  const fresh = players.filter((p) => !hadBye.has(p));
  const candidates = fresh.length > 0 ? fresh : players;
  return candidates.some((bye) => pairUp(players.filter((p) => p !== bye)));
}

/** A small deterministic PRNG (mulberry32), so the property test is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('generateSwissRound without avoidable rematches (#39)', () => {
  it('pairs the reported 6-player round 3 without a rematch', () => {
    const ids = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
    const history: MatchRecord[] = [
      { player_1_id: 'P0', player_2_id: 'P1', winner_id: 'P0', round_number: 1 },
      { player_1_id: 'P2', player_2_id: 'P3', winner_id: 'P2', round_number: 1 },
      { player_1_id: 'P5', player_2_id: 'P4', winner_id: 'P5', round_number: 1 },
      { player_1_id: 'P0', player_2_id: 'P2', winner_id: 'P0', round_number: 2 },
      { player_1_id: 'P1', player_2_id: 'P5', winner_id: 'P1', round_number: 2 },
      { player_1_id: 'P3', player_2_id: 'P4', winner_id: 'P3', round_number: 2 },
    ];
    const met = new Set(history.map((m) => pairKey(m.player_1_id, m.player_2_id)));
    const round = generateSwissRound(ids, Object.fromEntries(ids.map((id) => [id, id])), history, 3);
    expect(round.pairings).toHaveLength(3);
    for (const p of round.pairings) expect(met.has(pairKey(p.player_1_id, p.player_2_id))).toBe(false);
    // The leader still meets the best-placed opponent it has not played.
    expect(round.pairings[0]).toEqual({ player_1_id: 'P0', player_2_id: 'P3' });
  });

  it('never returns a rematch when a brute-force search finds a rematch-free round (4 to 12 players)', () => {
    const random = rng(39);
    let rounds = 0;
    for (let n = 4; n <= 12; n += 1) {
      const ids = Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}`);
      const names = Object.fromEntries(ids.map((id) => [id, id]));
      const lastRound = Math.ceil(Math.log2(n)) + 1;
      for (let event = 0; event < 6; event += 1) {
        const history: MatchRecord[] = [];
        const byes: { player_id: string; round_number: number }[] = [];
        for (let r = 1; r <= lastRound; r += 1) {
          const round = generateSwissRound(ids, names, history, r, byes);
          const met = new Set(history.map((m) => pairKey(m.player_1_id, m.player_2_id)));
          const hadBye = new Set(byes.map((b) => b.player_id));
          const rematches = round.pairings.filter((p) => met.has(pairKey(p.player_1_id, p.player_2_id))).length;
          if (rematchFreeExists(ids, met, hadBye)) expect(rematches, `n=${n} event=${event} round=${r}`).toBe(0);
          // Everyone plays or has the bye, exactly once.
          const seen = round.pairings.flatMap((p) => [p.player_1_id, p.player_2_id]).concat(round.bye_player_ids);
          expect(new Set(seen).size).toBe(n);
          for (const p of round.pairings) {
            history.push({ ...p, winner_id: random() < 0.5 ? p.player_1_id : p.player_2_id, round_number: r });
          }
          for (const id of round.bye_player_ids) byes.push({ player_id: id, round_number: r });
          rounds += 1;
        }
      }
    }
    expect(rounds).toBeGreaterThan(200);
  });

  it('takes the first fewest-rematch pairing in standings order when every pairing repeats a match', () => {
    // Four players who have all met: every pairing has two rematches, so standings order decides.
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const pairs: Array<[string, string]> = [['p1', 'p2'], ['p3', 'p4'], ['p1', 'p3'], ['p2', 'p4'], ['p1', 'p4'], ['p2', 'p3']];
    const history: MatchRecord[] = pairs.map(([a, b], i) => ({ player_1_id: a, player_2_id: b, winner_id: a, round_number: Math.floor(i / 2) + 1 }));
    const names = Object.fromEntries(ids.map((id) => [id, id]));
    const standings = computeStandings(ids, names, history).map((s) => s.player_id);
    const round = generateSwissRound(ids, names, history, 4);
    expect(round.pairings).toEqual([
      { player_1_id: standings[0], player_2_id: standings[1] },
      { player_1_id: standings[2], player_2_id: standings[3] },
    ]);
    expect(round.bye_player_ids).toEqual([]);
  });

  it('gives the bye to a player without one, and still pairs the rest without a rematch', () => {
    // Five players; e already had two byes, so the bye goes to the lowest-placed player without one whose removal leaves a
    // rematch-free pairing of the other four.
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const history: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'a', round_number: 2 },
      { player_1_id: 'b', player_2_id: 'd', winner_id: 'b', round_number: 2 },
    ];
    const byes = [
      { player_id: 'e', round_number: 1 },
      { player_id: 'e', round_number: 2 },
    ];
    const met = new Set(history.map((m) => pairKey(m.player_1_id, m.player_2_id)));
    const round = generateSwissRound(ids, Object.fromEntries(ids.map((id) => [id, id])), history, 3, byes);
    for (const p of round.pairings) expect(met.has(pairKey(p.player_1_id, p.player_2_id))).toBe(false);
    expect(round.bye_player_ids).toHaveLength(1);
    expect(round.bye_player_ids[0]).not.toBe('e');
  });
});
