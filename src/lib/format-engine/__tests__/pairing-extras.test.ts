import { describe, expect, it } from 'vitest';
import type { Expr } from '@/lib/format-kit/expr/ast';
import type { Stage } from '@/lib/format-kit/types';
import type { MatchRecord } from '@/lib/tournament/types';
import { pairNextRound, type KitPairingInput } from '../pairing';

const ids = ['a', 'b', 'c', 'd'];
const names = { a: 'A', b: 'B', c: 'C', d: 'D' };
const m = (id: string, p1: string, p2: string, winner: string): MatchRecord => ({
  match_id: id,
  player_1_id: p1,
  player_2_id: p2,
  winner_id: winner,
  round_number: 1,
});
const key = (p: { player_1_id: string; player_2_id: string }) => [p.player_1_id, p.player_2_id].sort().join('-');

const history = [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c')];

function swissRound2(over: Partial<KitPairingInput> = {}, rank: Stage['rank'] = []) {
  const result = pairNextRound({
    stage: {
      key: 'swiss',
      pairing: { kind: 'swiss', rounds: 3, avoid_repeats: true },
      scoring: { win: 3, loss: 0, bye: 0 },
      rank,
    },
    participantIds: ids,
    participantNames: names,
    matches: history,
    pairedMatches: history,
    byeHistory: [],
    roundNumber: 2,
    ...over,
  });
  if (result.kind !== 'round') throw new Error('expected a round');
  return result.round.pairings.map(key).sort();
}

describe('a Swiss round ranks by the same table as the standings', () => {
  it('pairs the winners together and the losers together by default', () => {
    expect(swissRound2()).toEqual(['a-c', 'b-d']);
  });

  it('lets points an admin added move a player up before the pairing', () => {
    // b lost round 1 but holds the most points now: b meets a winner, a meets the other loser.
    expect(swissRound2({ tableExtras: { pointAdjustments: { b: 10 } } })).toEqual(['a-d', 'b-c']);
  });

  it('ranks by a custom metric the stage names', () => {
    const rank: Stage['rank'] = [{ kind: 'metric', metric: 'bonus', direction: 'desc' }];
    const bonus: Expr = {
      k: 'if',
      cond: { k: 'cmp', op: '==', a: { k: 'ref', name: 'player', t: 'text' }, b: { k: 'str', v: 'b' } },
      then: { k: 'num', v: 100 },
      else: { k: 'num', v: 0 },
    };
    // Unknown to the table, the metric is skipped and the order stays a, b, c, d.
    expect(swissRound2({}, rank)).toEqual(['a-c', 'b-d']);
    expect(swissRound2({ tableExtras: { metricDefs: [{ key: 'bonus', expr: bonus }] } }, rank)).toEqual(['a-d', 'b-c']);
  });
});

describe('a Swiss round counts games like the standings', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  const sixHistory = [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c'), m('3', 'e', 'f', 'e')];
  const rank: Stage['rank'] = [{ kind: 'metric', metric: 'games_played', direction: 'desc' }];
  const round = (tableExtras?: KitPairingInput['tableExtras']) => {
    const result = pairNextRound({
      stage: { key: 'swiss', pairing: { kind: 'swiss', rounds: 3, avoid_repeats: true }, scoring: { win: 3, loss: 0, bye: 0 }, rank },
      participantIds: six,
      participantNames: Object.fromEntries(six.map((id) => [id, id.toUpperCase()])),
      matches: sixHistory,
      pairedMatches: sixHistory,
      byeHistory: [],
      roundNumber: 2,
      tableExtras,
    });
    if (result.kind !== 'round') throw new Error('expected a round');
    return result.round.pairings.map(key).sort();
  };

  it('ranks by games_played from the extras the generate routes load', () => {
    const without = round();
    // The e-f series was the longest and a-b the shortest: the games reorder the table, so the pairs change.
    const counted = round({ gameCounts: { '1': 1, '2': 2, '3': 3 } });
    expect(counted).not.toEqual(without);
    expect(without).toEqual(['a-c', 'b-e', 'd-f']);
    expect(counted).toEqual(['a-f', 'b-d', 'c-e']);
  });
});
