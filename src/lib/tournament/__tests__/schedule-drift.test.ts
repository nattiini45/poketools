import { describe, expect, it } from 'vitest';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '../round-robin';
import { assertNoScheduleDrift, findScheduleDrift, RoundRobinScheduleDriftError } from '../schedule-drift';
import type { MatchRecord, Pairing } from '../types';

function record(p1: string, p2: string, round: number): MatchRecord {
  return { player_1_id: p1, player_2_id: p2, winner_id: null, round_number: round };
}

function recordsOf(order: string[], rounds: number[]): MatchRecord[] {
  return rounds.flatMap((round) =>
    generateRoundRobinRound(order, round).pairings.map((p) => record(p.player_1_id, p.player_2_id, round)),
  );
}

describe('findScheduleDrift', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('finds nothing when the order did not change', () => {
    const existing = recordsOf(order, [1, 2]);
    for (let round = 3; round <= getRoundRobinTotalRounds(order.length); round++) {
      expect(findScheduleDrift(generateRoundRobinRound(order, round).pairings, existing)).toBeNull();
    }
  });

  it('finds the first pair a changed order would write again, whatever the status of the earlier match', () => {
    const existing = recordsOf(order, [1, 2]);
    // "b" renamed so that it sorts last: the rotation of rounds 3..5 starts from a different circle.
    const renamed = ['a', 'c', 'd', 'e', 'f', 'b'];
    const drifted = [3, 4, 5].flatMap((round) => {
      const hit = findScheduleDrift(generateRoundRobinRound(renamed, round).pairings, existing);
      return hit ? [hit] : [];
    });
    expect(drifted.length).toBeGreaterThan(0);
    expect(drifted[0].round_number).toBeLessThanOrEqual(2);
  });

  it('treats a pair as unordered', () => {
    const hit = findScheduleDrift([{ player_1_id: 'b', player_2_id: 'a' }], [record('a', 'b', 1)]);
    expect(hit).toMatchObject({ round_number: 1 });
  });

  it('ignores the matches of the round being written (a refilled round, a retry)', () => {
    const pairings: Pairing[] = [{ player_1_id: 'a', player_2_id: 'b' }];
    expect(findScheduleDrift(pairings, [record('a', 'b', 3)], { ignoreRoundNumber: 3 })).toBeNull();
    expect(findScheduleDrift(pairings, [record('a', 'b', 3)])).not.toBeNull();
  });
});

describe('assertNoScheduleDrift', () => {
  it('throws a 409 round_robin_schedule_drift naming the round, and returns on a clean schedule', () => {
    const pairings: Pairing[] = [{ player_1_id: 'a', player_2_id: 'b' }];
    expect(() => assertNoScheduleDrift('Round 3', pairings, [])).not.toThrow();
    try {
      assertNoScheduleDrift('Round 3', pairings, [record('a', 'b', 1)]);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RoundRobinScheduleDriftError);
      expect(err).toMatchObject({
        code: 'round_robin_schedule_drift',
        statusCode: 409,
        params: { round: 'Round 3' },
      });
    }
  });
});
