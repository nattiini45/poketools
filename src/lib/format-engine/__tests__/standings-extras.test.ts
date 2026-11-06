import { describe, expect, it } from 'vitest';
import type { Expr } from '@/lib/format-kit/expr/ast';
import type { RankStep, Scoring } from '@/lib/format-kit/types';
import { computeStageStandings, kitOutcomesByMatch, toKitOutcome, type StageStandingsInput } from '../standings';

const SCORING: Scoring = { win: 3, loss: 0, bye: 0 };
const ids = ['a', 'b', 'c', 'd'];
const names = { a: 'A', b: 'B', c: 'C', d: 'D' };
function table(over: Partial<StageStandingsInput> = {}, rank: RankStep[] = []) {
  return computeStageStandings({
    stage: { key: 'league', scoring: SCORING, rank },
    participantIds: ids,
    participantNames: names,
    matches: [],
    ...over,
  });
}

const num = (v: number): Expr => ({ k: 'num', v });

describe('toKitOutcome', () => {
  it('keeps the three standings columns of an outcome row and nothing else', () => {
    const row = { match_id: 'm1', kind: 'forfeit', p1_faints: null, p2_faints: 2, source: 'admin', reason: 'secret', set_by: 'adm' } as const;
    expect(toKitOutcome(row)).toEqual({ kind: 'forfeit', p1_faints: null, p2_faints: 2 });
    expect(kitOutcomesByMatch([row, { match_id: 'm2', kind: 'played', p1_faints: 1, p2_faints: 0 }])).toEqual({
      m1: { kind: 'forfeit', p1_faints: null, p2_faints: 2 },
      m2: { kind: 'played', p1_faints: 1, p2_faints: 0 },
    });
  });
});

describe('the seed and rating metrics read what the caller feeds', () => {
  it('ranks by seed, unseeded players last', () => {
    const rank: RankStep[] = [{ kind: 'metric', metric: 'seed', direction: 'asc' }];
    const rows = table({ seeds: { a: 3, b: 1, c: 2 } }, rank);
    expect(rows.map((r) => r.player_id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('ties everybody on seed and rating when nothing is fed (participant order stays)', () => {
    const seed = table({}, [{ kind: 'metric', metric: 'seed', direction: 'asc' }]);
    const rating = table({}, [{ kind: 'metric', metric: 'rating', direction: 'desc' }]);
    expect(seed.map((r) => r.player_id)).toEqual(ids);
    expect(rating.map((r) => r.player_id)).toEqual(ids);
  });

  it('ranks by rating, best first', () => {
    const rows = table({ ratings: { a: 1500, b: 1700, c: 1600, d: 1400 } }, [{ kind: 'metric', metric: 'rating', direction: 'desc' }]);
    expect(rows.map((r) => r.player_id)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('custom metrics in a table', () => {
  const santaIsB: Expr = {
    k: 'if',
    cond: { k: 'rel', relation: 'santa', a: { k: 'ref', name: 'player', t: 'text' }, b: { k: 'str', v: 'b' } },
    then: num(10),
    else: num(0),
  };

  it('answers rel() from the links it is given, and false without them', () => {
    const base = { metricDefs: [{ key: 'gifted', expr: santaIsB }] };
    const without = table(base);
    expect(without.every((r) => r.metrics?.gifted === 0)).toBe(true);
    const withLinks = table({ ...base, relations: { santa: [['a', 'b']] } });
    expect(Object.fromEntries(withLinks.map((r) => [r.player_id, r.metrics?.gifted]))).toEqual({ a: 10, b: 0, c: 0, d: 0 });
  });

  it('draws rand() per player, and the same draw on every evaluation', () => {
    const draw: StageStandingsInput['metricDefs'] = [{ key: 'luck', expr: { k: 'rand', key: 'tiebreak' } }];
    const first = table({ metricDefs: draw, seed: 'season-seed' });
    const again = table({ metricDefs: draw, seed: 'season-seed' });
    const luck = first.map((r) => r.metrics?.luck);
    expect(new Set(luck).size).toBe(ids.length);
    expect(again.map((r) => r.metrics?.luck)).toEqual(luck);
    expect(table({ metricDefs: draw, seed: 'another-seed' }).map((r) => r.metrics?.luck)).not.toEqual(luck);
  });

  it('ranks by a custom metric and by a point adjustment', () => {
    const rows = table(
      {
        metricDefs: [{ key: 'bonus', expr: { k: 'ref', name: 'points', t: 'number' } }],
        pointAdjustments: { d: 5 },
      },
      [{ kind: 'metric', metric: 'bonus', direction: 'desc' }],
    );
    expect(rows[0]).toMatchObject({ player_id: 'd', points: 5 });
  });
});
