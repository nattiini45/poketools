import { describe, expect, it } from 'vitest';
import type { Pairing, Stage } from '@/lib/format-kit/types';
import {
  filteredRoundRobinRound,
  isChallengeLadder,
  kitPairsRounds,
  kitStageRounds,
  pairNextRound,
  roundRobinOf,
  type KitPairingInput,
} from '../pairing';
import { planForbiddenPairingCheck } from '../runtime/pairing-checks';

const ids = ['a', 'b', 'c', 'd'];
const names = { a: 'A', b: 'B', c: 'C', d: 'D' };
const key = (p: { player_1_id: string; player_2_id: string }) => [p.player_1_id, p.player_2_id].sort().join('-');
const allowExpr = { k: 'bool', v: true } as const;
const roundRobin = { kind: 'round_robin', legs: 1, mirror_legs: true } as const;
const swiss = { kind: 'swiss', rounds: 'auto', avoid_repeats: true } as const;

function input(pairing: Pairing, over: Partial<KitPairingInput> = {}): KitPairingInput {
  const stage: Pick<Stage, 'key' | 'pairing' | 'scoring' | 'rank'> = {
    key: 'stage',
    pairing,
    scoring: { win: 1, loss: 0, bye: 1 },
    rank: [],
  };
  return { stage, participantIds: ids, participantNames: names, matches: [], pairedMatches: [], byeHistory: [], roundNumber: 1, ...over };
}

describe('filter pairing kinds', () => {
  it('counts the rounds of the base and pairs round by round', () => {
    expect(kitStageRounds({ kind: 'filter', base: roundRobin, allow: allowExpr }, 4)).toBe(3);
    expect(kitStageRounds({ kind: 'filter', base: swiss, allow: allowExpr }, 4)).toBe(2);
    expect(kitStageRounds({ kind: 'bipartite', attr: 'side', side_a: ['x'], side_b: ['y'], rounds: 5, avoid_repeats: true }, 4)).toBe(5);
    expect(kitPairsRounds({ pairing: { kind: 'filter', base: swiss, allow: allowExpr } })).toBe(true);
    expect(roundRobinOf({ kind: 'filter', base: roundRobin, allow: allowExpr })).toBe(roundRobin);
    expect(roundRobinOf({ kind: 'filter', base: swiss, allow: allowExpr })).toBeNull();
  });

  it('drops the rejected pairs of a round robin round and counts them', () => {
    const round = filteredRoundRobinRound(ids, roundRobin, 1, (a, b) => ![a, b].includes('a'));
    expect(round.pairings).toHaveLength(1);
    expect(round.pairings.map(key).every((k) => !k.includes('a'))).toBe(true);
    expect(round.forbidden).toBe(1);
  });

  it('pairs a filtered Swiss round without the rejected pair', () => {
    const result = pairNextRound(
      input({ kind: 'filter', base: swiss, allow: allowExpr }, { allowPair: (a, b) => [a, b].sort().join('-') !== 'a-b' }),
    );
    expect(result.kind).toBe('round');
    if (result.kind !== 'round') return;
    expect(result.round.pairings.map(key)).not.toContain('a-b');
    expect(result.round.forbidden).toBe(0);
  });

  it('throws for a filter or bipartite stage without its aid', () => {
    expect(() => pairNextRound(input({ kind: 'filter', base: swiss, allow: allowExpr }))).toThrow(/allowPair/);
    expect(() => pairNextRound(input({ kind: 'filter', base: roundRobin, allow: allowExpr }))).toThrow(/allowPair/);
    expect(() =>
      pairNextRound(input({ kind: 'bipartite', attr: 'side', side_a: ['x'], side_b: ['y'], rounds: 2, avoid_repeats: true })),
    ).toThrow(/sides/);
  });

  it('pairs a bipartite round by the given sides', () => {
    const result = pairNextRound(
      input(
        { kind: 'bipartite', attr: 'side', side_a: ['x'], side_b: ['y'], rounds: 2, avoid_repeats: true },
        { sides: { a: 'a', b: 'a', c: 'b', d: 'b' } },
      ),
    );
    expect(result.kind).toBe('round');
    if (result.kind !== 'round') return;
    expect(result.round.pairings.every((p) => 'ab'.includes(p.player_1_id) && 'cd'.includes(p.player_2_id))).toBe(true);
  });

  it('does not pair a challenge ladder', () => {
    const pairing = { kind: 'challenge', rounds: 3, rank_range: 2, max_open: 1, cooldown_rounds: 1, accept_window_hours: 72 } as const;
    expect(isChallengeLadder(pairing)).toBe(true);
    expect(pairNextRound(input(pairing))).toEqual({ kind: 'challenge' });
    expect(kitStageRounds(pairing, 4)).toBeNull();
    expect(kitPairsRounds({ pairing })).toBe(false);
  });
});

describe('planForbiddenPairingCheck', () => {
  it('opens a check per stage and round only when pairs were rejected', () => {
    expect(planForbiddenPairingCheck('main', 2, 0)).toBeNull();
    expect(planForbiddenPairingCheck('main', 2, 3)).toMatchObject({
      source: 'pairing_forbidden',
      dedupe_key: 'forbidden:main:2',
      subject: { stage: 'main', round: 2, forbidden: 3 },
    });
  });
});
