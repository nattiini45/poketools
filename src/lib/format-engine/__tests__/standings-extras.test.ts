import { describe, expect, it } from 'vitest';
import type { Expr } from '@/lib/format-kit/expr/ast';
import type { RankStep, Scoring } from '@/lib/format-kit/types';
import { computeStageStandings, kitOutcomesByMatch, stageCountsKills, toKitOutcome, type StageStandingsInput } from '../standings';

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

describe('games_played counts the games of the completed matches', () => {
  const rec = (match_id: string, p1: string, p2: string, winner: string, round_number = 1) => ({ match_id, player_1_id: p1, player_2_id: p2, winner_id: winner, round_number });
  const matches = [rec('m1', 'a', 'b', 'a'), rec('m2', 'a', 'b', 'b', 2), rec('m3', 'c', 'd', 'c')];
  const played = (rows: ReturnType<typeof table>) => Object.fromEntries(rows.map((r) => [r.player_id, r.games_played]));

  it('reads the per-match counts, a rematch of the same pair counting its own games', () => {
    const rows = table({ matches, gameCounts: { m1: 2, m2: 3, m3: 1 } });
    expect(played(rows)).toEqual({ a: 5, b: 5, c: 1, d: 1 });
  });

  it('ranks and filters by games_played, and honours the round filter', () => {
    const rank: RankStep[] = [{ kind: 'metric', metric: 'games_played', direction: 'desc' }];
    expect(table({ matches, gameCounts: { m1: 2, m2: 3, m3: 1 } }, rank).map((r) => r.player_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(played(table({ matches, gameCounts: { m1: 2, m2: 3, m3: 1 }, maxRound: 1 }))).toEqual({ a: 2, b: 2, c: 1, d: 1 });
  });

  it('counts nothing without counts, and a match missing from them has no games', () => {
    expect(played(table({ matches }))).toEqual({ a: 0, b: 0, c: 0, d: 0 });
    expect(played(table({ matches, gameCounts: { m3: 2 } }))).toEqual({ a: 0, b: 0, c: 2, d: 2 });
  });

  it('lets the legacy game list of a match win over the counts', () => {
    const rows = table({ matches, gamesByMatch: { m1: ['a', 'b', 'a'] }, gameCounts: { m1: 1, m3: 2 } });
    expect(played(rows)).toEqual({ a: 3, b: 3, c: 2, d: 2 });
  });
});

describe('kill_differential reads the battle stats', () => {
  const stat = (player_id: string, kos_dealt: number, was_koed: boolean, round_number = 1) => ({
    game_id: `g-${player_id}-${round_number}`,
    player_id,
    pokemon_name: 'x',
    was_brought: true,
    was_lead: false,
    kos_dealt,
    was_koed,
    round_number,
  });
  const kills = (rows: ReturnType<typeof table>) => Object.fromEntries(rows.map((r) => [r.player_id, r.kill_differential]));

  it('sums the kills a player dealt minus the Pokemon they lost, honouring the round filter', () => {
    const battleStats = [stat('a', 3, false), stat('b', 1, true), stat('a', 2, true, 2)];
    expect(kills(table({ battleStats }))).toEqual({ a: 4, b: 0, c: 0, d: 0 });
    expect(kills(table({ battleStats, maxRound: 1 }))).toEqual({ a: 3, b: 0, c: 0, d: 0 });
  });

  it('is 0 for every player without the stats, which is why the loaders must pass them', () => {
    expect(kills(table())).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });
});

describe('stageCountsKills', () => {
  it.each([
    [{ kind: 'round_robin', legs: 1, mirror_legs: true }, true],
    [{ kind: 'manual' }, true],
    [{ kind: 'swiss', rounds: 'auto', avoid_repeats: true }, false],
    [{ kind: 'single_elim', third_place: false }, false],
  ] as const)('%j counts kills: %s', (pairing, expected) => {
    expect(stageCountsKills({ pairing: pairing as never })).toBe(expected);
  });

  it('follows the base of a filter, as the legacy bracket type does', () => {
    expect(stageCountsKills({ pairing: { kind: 'filter', base: { kind: 'swiss' } } as never })).toBe(false);
    expect(stageCountsKills({ pairing: { kind: 'filter', base: { kind: 'round_robin' } } as never })).toBe(true);
  });
});
