import { describe, expect, it } from 'vitest';
import type { Pairing, Stage } from '@/lib/format-kit/types';
import type { MatchRecord } from '@/lib/tournament/types';
import { formKitGroups, kitPairsRounds, kitStageRounds, legRoundRange, pairNextRound, roundRobinLegRound, type KitPairingInput } from '../pairing';

const ids = ['a', 'b', 'c', 'd'];
const names = { a: 'A', b: 'B', c: 'C', d: 'D' };
const pairKey = (p: { player_1_id: string; player_2_id: string }) => [p.player_1_id, p.player_2_id].sort().join('-');

function input(pairing: Pairing, over: Partial<KitPairingInput> = {}): KitPairingInput {
  const stage: Pick<Stage, 'key' | 'pairing' | 'scoring' | 'rank'> = {
    key: 'stage',
    pairing,
    scoring: { win: 1, loss: 0, bye: 1 },
    rank: [],
  };
  return { stage, participantIds: ids, participantNames: names, matches: [], pairedMatches: [], byeHistory: [], roundNumber: 1, ...over };
}

describe('kitStageRounds', () => {
  it('counts Swiss rounds (auto is ceil log2 n) and round robin legs', () => {
    expect(kitStageRounds({ kind: 'swiss', rounds: 'auto', avoid_repeats: true }, 9)).toBe(4);
    expect(kitStageRounds({ kind: 'swiss', rounds: 3, avoid_repeats: true }, 9)).toBe(3);
    expect(kitStageRounds({ kind: 'round_robin', legs: 2, mirror_legs: true }, 4)).toBe(6);
    expect(kitStageRounds({ kind: 'round_robin', legs: 1, mirror_legs: true }, 5)).toBe(5);
    expect(kitStageRounds({ kind: 'manual' }, 8)).toBeNull();
    expect(kitStageRounds({ kind: 'single_elim', third_place: false }, 1)).toBe(0);
  });

  it('pairs rounds itself only for Swiss and round robin', () => {
    expect(kitPairsRounds({ pairing: { kind: 'swiss', rounds: 'auto', avoid_repeats: true } })).toBe(true);
    expect(kitPairsRounds({ pairing: { kind: 'round_robin', legs: 1, mirror_legs: true } })).toBe(true);
    expect(kitPairsRounds({ pairing: { kind: 'double_elim', bracket_reset: true } })).toBe(false);
    expect(kitPairsRounds({ pairing: { kind: 'manual' } })).toBe(false);
  });
});

describe('roundRobinLegRound', () => {
  it('replays the first leg with sides swapped; mirror_legs keeps the round order', () => {
    const pairing = { kind: 'round_robin', legs: 2, mirror_legs: true } as const;
    for (let r = 1; r <= 3; r += 1) {
      const first = roundRobinLegRound(ids, pairing, r);
      const second = roundRobinLegRound(ids, pairing, r + 3);
      expect(second.round_number).toBe(r + 3);
      expect(second.pairings).toEqual(first.pairings.map((p) => ({ player_1_id: p.player_2_id, player_2_id: p.player_1_id })));
    }
  });

  it('runs the second leg in reverse round order without mirror_legs', () => {
    const pairing = { kind: 'round_robin', legs: 2, mirror_legs: false } as const;
    const first = roundRobinLegRound(ids, pairing, 1).pairings.map(pairKey).sort();
    const lastOfSecond = roundRobinLegRound(ids, pairing, 6).pairings.map(pairKey).sort();
    expect(lastOfSecond).toEqual(first);
  });

  it('meets every pair exactly once per leg', () => {
    const pairing = { kind: 'round_robin', legs: 2, mirror_legs: true } as const;
    const leg = [1, 2, 3].flatMap((r) => roundRobinLegRound(ids, pairing, r).pairings.map(pairKey));
    expect(new Set(leg).size).toBe(6);
    expect(leg).toHaveLength(6);
  });

  it('refuses a round outside the schedule', () => {
    expect(() => roundRobinLegRound(ids, { kind: 'round_robin', legs: 1, mirror_legs: true }, 4)).toThrow(/Invalid round number 4/);
  });

  it('gives the rounds of the leg a round belongs to', () => {
    expect(legRoundRange(4, 1)).toEqual({ first: 1, last: 3 });
    expect(legRoundRange(4, 5)).toEqual({ first: 4, last: 6 });
  });
});

describe('pairNextRound', () => {
  it('leaves manual and elimination stages to the admin and the bracket engine', () => {
    expect(pairNextRound(input({ kind: 'manual' }))).toEqual({ kind: 'manual' });
    expect(pairNextRound(input({ kind: 'single_elim', third_place: true }))).toEqual({ kind: 'bracket' });
  });

  it('reports a stage whose rounds are all written', () => {
    expect(pairNextRound(input({ kind: 'swiss', rounds: 'auto', avoid_repeats: true }, { roundNumber: 3 }))).toEqual({
      kind: 'complete',
      rounds: 2,
    });
  });

  it('pairs Swiss score groups without a rematch', () => {
    const round1: MatchRecord[] = [
      { match_id: '1', player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { match_id: '2', player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
    ];
    const result = pairNextRound(
      input({ kind: 'swiss', rounds: 'auto', avoid_repeats: true }, { matches: round1, pairedMatches: round1, roundNumber: 2 }),
    );
    expect(result.kind).toBe('round');
    if (result.kind !== 'round') return;
    expect(result.round.pairings.map(pairKey).sort()).toEqual(['a-c', 'b-d']);
    expect(result.round.rematches ?? 0).toBe(0);
  });

  it('pairs a round robin round from the circle', () => {
    const result = pairNextRound(input({ kind: 'round_robin', legs: 1, mirror_legs: true }, { roundNumber: 2 }));
    expect(result).toEqual({ kind: 'round', round: roundRobinLegRound(ids, { kind: 'round_robin', legs: 1, mirror_legs: true }, 2) });
  });
});

describe('formKitGroups', () => {
  const players = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
  const members = (groups: ReturnType<typeof formKitGroups>) => groups.map((g) => g.members.map((m) => m.player_id));

  it('snakes the seeds for serpentine', () => {
    expect(members(formKitGroups(players, { count: 3, method: 'serpentine' }, { stageKey: 'g' }))).toEqual([
      ['s1', 's6', 's7'],
      ['s2', 's5'],
      ['s3', 's4'],
    ]);
  });

  it('fills groups in order for straight, sizes differing by at most one', () => {
    expect(members(formKitGroups(players, { count: 3, method: 'straight' }, { stageKey: 'g' }))).toEqual([
      ['s1', 's2', 's3'],
      ['s4', 's5'],
      ['s6', 's7'],
    ]);
  });

  it('shuffles with the season seed for random_seeded: the same seed gives the same groups', () => {
    const one = formKitGroups(players, { count: 2, method: 'random_seeded' }, { seed: 'x', stageKey: 'g' });
    const two = formKitGroups(players, { count: 2, method: 'random_seeded' }, { seed: 'x', stageKey: 'g' });
    expect(one).toEqual(two);
    expect(members(one).flat().sort()).toEqual(players);
    expect(one.map((g) => g.members.length)).toEqual([4, 3]);
    expect(one[0].members.map((m) => m.seed)).toEqual([1, 2, 3, 4]);
  });

  it('forms nothing for manual placement and drops empty groups', () => {
    expect(formKitGroups(players, { count: 2, method: 'manual' }, { stageKey: 'g' })).toEqual([]);
    expect(formKitGroups(['s1', 's2'], { count: 4, method: 'straight' }, { stageKey: 'g' }).map((g) => g.group_number)).toEqual([1, 2]);
  });
});
