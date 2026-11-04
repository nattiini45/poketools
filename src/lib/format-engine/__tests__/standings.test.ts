import { describe, expect, it } from 'vitest';
import type { RankStep, Scoring } from '@/lib/format-kit/types';
import type { MatchRecord } from '@/lib/tournament/types';
import { diffStandings, kitForPhase, kitStandings, phaseOfMatches, ranksWithKit, type KitStandingsData } from '../context';
import { coinFlipDraws, computeStageStandings, computeViewStandings, scoreMatch, type StageStandingsInput } from '../standings';

const SCORING: Scoring = { win: 3, loss: 0, bye: 0 };
const ids = ['a', 'b', 'c', 'd'];
const names = { a: 'A', b: 'B', c: 'C', d: 'D' };
const m = (id: string, p1: string, p2: string, winner: string | null, round = 1): MatchRecord => ({
  match_id: id,
  player_1_id: p1,
  player_2_id: p2,
  winner_id: winner,
  round_number: round,
});

function table(over: Partial<StageStandingsInput> & Pick<StageStandingsInput, 'matches'>, rank: RankStep[] = [], scoring = SCORING) {
  return computeStageStandings({
    stage: { key: 'league', scoring, rank },
    participantIds: ids,
    participantNames: names,
    ...over,
  });
}

describe('scoreMatch', () => {
  const match = m('x', 'a', 'b', 'a');

  it('never scores an unresolved outcome', () => {
    expect(scoreMatch(match, SCORING, { kind: 'unresolved', p1_faints: null, p2_faints: null })).toBeNull();
  });

  it('scores a forfeit like a played match when the stage has no forfeit points', () => {
    expect(scoreMatch(match, SCORING, { kind: 'forfeit', p1_faints: null, p2_faints: null })).toEqual({ p1: 3, p2: 0 });
  });

  it('scores forfeit and no-show points, with the number shorthand and the object form', () => {
    expect(scoreMatch(match, { ...SCORING, loss: 1, forfeit: 2 }, { kind: 'no_show', p1_faints: null, p2_faints: null })).toEqual({
      p1: 2,
      p2: 1,
    });
    expect(
      scoreMatch(match, { ...SCORING, forfeit: { win: 5, loss: -1, faint_bonus: false } }, { kind: 'forfeit', p1_faints: null, p2_faints: null }),
    ).toEqual({ p1: 5, p2: -1 });
  });

  it('adds the per-opponent faint bonus of a played match, never for a forfeit', () => {
    const scoring: Scoring = { win: 30, loss: 10, bye: 0, per_opponent_faint: 1, forfeit: { win: 30, loss: 0, faint_bonus: false } };
    expect(scoreMatch(match, scoring, { kind: 'played', p1_faints: 2, p2_faints: 6 })).toEqual({ p1: 36, p2: 12 });
    expect(scoreMatch(match, scoring, { kind: 'forfeit', p1_faints: null, p2_faints: null })).toEqual({ p1: 30, p2: 0 });
    // A match completed before outcomes were recorded has no tally: no bonus.
    expect(scoreMatch(match, scoring, undefined)).toEqual({ p1: 30, p2: 10 });
  });

  it('scores a match without a winner as a draw', () => {
    expect(scoreMatch(m('x', 'a', 'b', null), { ...SCORING, draw: 1 }, undefined)).toEqual({ p1: 1, p2: 1 });
  });
});

describe('computeStageStandings', () => {
  it('records faints and forfeits, and leaves an unresolved match out of the record', () => {
    const rows = table({
      matches: [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c'), m('3', 'a', 'c', 'c')],
      outcomes: {
        '1': { kind: 'played', p1_faints: 1, p2_faints: 6 },
        '2': { kind: 'forfeit', p1_faints: null, p2_faints: null },
        '3': { kind: 'unresolved', p1_faints: null, p2_faints: null },
      },
    });
    const byId = Object.fromEntries(rows.map((r) => [r.player_id, r]));
    expect(byId.a).toMatchObject({ wins: 1, losses: 0, faints_dealt: 6, faints_taken: 1 });
    expect(byId.c).toMatchObject({ wins: 1, losses: 0, forfeit_wins: 1 });
    expect(byId.d).toMatchObject({ losses: 1, forfeit_losses: 1 });
  });

  it('ranks by faints dealt when the chain says so', () => {
    const rows = table(
      {
        matches: [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c')],
        outcomes: { '1': { kind: 'played', p1_faints: 0, p2_faints: 3 }, '2': { kind: 'played', p1_faints: 0, p2_faints: 6 } },
      },
      [
        { kind: 'metric', metric: 'points', direction: 'desc' },
        { kind: 'metric', metric: 'faints_dealt', direction: 'desc' },
      ],
    );
    expect(rows.map((r) => r.player_id)).toEqual(['c', 'a', 'b', 'd']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('settles a two-way tie pairwise but not a three-way one; the mini table settles any block', () => {
    // a wins twice (6 points); b, c and d win once each and stay level: pairwise cannot split three players.
    const matches = [m('1', 'a', 'b', 'a'), m('2', 'b', 'c', 'b'), m('3', 'c', 'a', 'c'), m('4', 'd', 'a', 'a'), m('5', 'd', 'b', 'd')];
    const points: RankStep = { kind: 'metric', metric: 'points', direction: 'desc' };
    const pairwise = table({ matches }, [points, { kind: 'head_to_head', scope: 'pairwise' }]);
    expect(pairwise.map((r) => r.player_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(pairwise.map((r) => r.tie_group)).toEqual([null, 1, 1, 1]);
    const two = table({ matches: [m('1', 'a', 'b', 'b'), m('2', 'c', 'd', 'c')] }, [points, { kind: 'head_to_head', scope: 'pairwise' }]);
    expect(two.map((r) => r.player_id)).toEqual(['b', 'c', 'a', 'd']);
    const ladder = [m('1', 'a', 'b', 'b'), m('2', 'b', 'c', 'b'), m('3', 'b', 'd', 'b'), m('4', 'c', 'a', 'c'), m('5', 'c', 'd', 'c'), m('6', 'd', 'a', 'd')];
    expect(table({ matches: ladder }, [{ kind: 'head_to_head', scope: 'pairwise' }]).map((r) => r.player_id)).toEqual(ids);
    const mini = table({ matches: ladder }, [{ kind: 'head_to_head', scope: 'mini_table' }]);
    expect(mini.map((r) => r.player_id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('flags the rows still tied when the chain ends in a decision match', () => {
    const rows = table({ matches: [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c')] }, [
      { kind: 'metric', metric: 'points', direction: 'desc' },
      { kind: 'decision_match' },
    ]);
    expect(rows.map((r) => [r.player_id, r.needs_decision_match, r.tie_group])).toEqual([
      ['a', true, 1],
      ['c', true, 1],
      ['b', true, 2],
      ['d', true, 2],
    ]);
  });

  it('breaks ties by the precomputed coin flip, the same with the seed on the server', () => {
    const chain: RankStep[] = [{ kind: 'coin_flip' }];
    const flips = coinFlipDraws('season-seed', 'league', ids);
    const client = table({ matches: [], coinFlips: flips }, chain);
    const server = table({ matches: [], seed: 'season-seed' }, chain);
    expect(client.map((r) => r.player_id)).toEqual(server.map((r) => r.player_id));
    expect([...client.map((r) => r.player_id)].sort()).toEqual(ids);
    expect(client.every((r) => r.tie_group === null)).toBe(true);
    const sorted = [...ids].sort((x, y) => flips[x] - flips[y]);
    expect(client.map((r) => r.player_id)).toEqual(sorted);
  });

  it('follows the admin order for a manual step, unlisted players stay tied behind', () => {
    const rows = table({ matches: [], manualOrder: ['c', 'a'] }, [{ kind: 'manual' }]);
    expect(rows.map((r) => r.player_id)).toEqual(['c', 'a', 'b', 'd']);
    expect(rows.map((r) => r.tie_group)).toEqual([null, null, 1, 1]);
  });

  it('counts only rounds up to maxRound and scores byes', () => {
    const rows = table(
      { matches: [m('1', 'a', 'b', 'a', 1), m('2', 'a', 'c', 'c', 2)], byes: [{ player_id: 'd', round_number: 1 }], maxRound: 1 },
      [],
      { win: 1, loss: 0, bye: 1 },
    );
    const byId = Object.fromEntries(rows.map((r) => [r.player_id, r]));
    expect(byId.a.points).toBe(1);
    expect(byId.c.points).toBe(0);
    expect(byId.d).toMatchObject({ wins: 1, points: 1, buchholz: 0 });
  });
});

describe('computeViewStandings', () => {
  it('sums one metric over the named stages and ranks highest first', () => {
    const one = table({ matches: [m('1', 'a', 'b', 'a')] });
    const two = table({ matches: [m('2', 'b', 'c', 'b'), m('3', 'b', 'd', 'b')] });
    const view = computeViewStandings({ stages: ['one', 'two', 'missing'], metric: 'points' }, { one, two });
    expect(view[0]).toMatchObject({ player_id: 'b', value: 6, by_stage: { one: 0, two: 6 }, rank: 1 });
    expect(view[1]).toMatchObject({ player_id: 'a', value: 3, rank: 2 });
  });
});

describe('kit standings context', () => {
  const kit: KitStandingsData = {
    engine: 'kit',
    stages: {
      p1: { key: 'groups', scoring: { win: 3, loss: 0, bye: 0 }, rank: [] },
      p2: { key: 'finals', scoring: { win: 1, loss: 0, bye: 0 }, rank: [] },
    },
    stageOfMatch: { '1': 'p1', '2': 'p2' },
    outcomes: {},
    coinFlips: { p1: {}, p2: {} },
  };

  it('ranks with the kit only for a custom league on the kit engine', () => {
    expect(ranksWithKit('custom', kit)).toBe(true);
    expect(ranksWithKit('custom', { ...kit, engine: 'shadow' })).toBe(false);
    expect(ranksWithKit('singles', kit)).toBe(false);
    expect(ranksWithKit('custom', undefined)).toBe(false);
  });

  it('finds the phase of a match list and narrows the data to one phase', () => {
    expect(phaseOfMatches(kit, [m('1', 'a', 'b', 'a')])).toBe('p1');
    expect(phaseOfMatches(kit, [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c')])).toBeNull();
    const narrowed = kitForPhase(kit, 'p2');
    expect(narrowed?.stages).toEqual({ p2: kit.stages.p2 });
    expect(narrowed?.stageOfMatch).toEqual({ '2': 'p2' });
    expect(kitForPhase(kit, 'p9')).toBeUndefined();
  });

  it('scores a season-wide list by each match its own phase', () => {
    const rows = kitStandings(kit, ids, names, [m('1', 'a', 'b', 'a'), m('2', 'c', 'd', 'c')]);
    const byId = Object.fromEntries(rows.map((r) => [r.player_id, r.points]));
    expect(byId).toEqual({ a: 3, b: 0, c: 1, d: 0 });
  });

  it('diffs only the rows whose place or points differ', () => {
    const legacy = table({ matches: [m('1', 'a', 'b', 'a')] });
    const same = table({ matches: [m('1', 'a', 'b', 'a')] });
    expect(diffStandings(legacy, same)).toEqual([]);
    const other = table({ matches: [m('1', 'a', 'b', 'b')] });
    expect(diffStandings(legacy, other).map((r) => [r.player_id, r.legacy_rank, r.kit_rank])).toEqual([
      ['b', 2, 1],
      ['a', 1, 2],
    ]);
  });
});
