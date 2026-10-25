import { describe, it, expect } from 'vitest';

import { computeStandingsForFormat } from '../standings';
import type { MatchRecord } from '../types';
import type { EvolutionStanding } from '../evolution-standings';
import { epbPack } from '@/lib/format-pack';

const names: Record<string, string> = { a: 'Alice', b: 'Bob', c: 'Charlie' };

// a beats b, b beats c, c beats a — everyone 1-1, tie on match points
const roundRobinTie: MatchRecord[] = [
  { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
  { player_1_id: 'b', player_2_id: 'c', winner_id: 'b', round_number: 2 },
  { player_1_id: 'c', player_2_id: 'a', winner_id: 'c', round_number: 3 },
];

describe('computeStandingsForFormat (dispatcher)', () => {
  it('uses the evolution-points tiebreaker for evolution_point_buy', () => {
    const standings = computeStandingsForFormat(
      'evolution_point_buy',
      ['a', 'b', 'c'],
      names,
      roundRobinTie,
      {},
      {},
      {},
      { evolutionPoints: { a: 0, b: 3, c: 1 } },
    );

    // All tied on points → evolution points decide: b (3) > c (1) > a (0)
    expect(standings.map((s) => s.player_id)).toEqual(['b', 'c', 'a']);
    expect((standings[0] as EvolutionStanding).evolution_points).toBe(3);
  });

  it('applies the pack EPB match points by default (example pack: 3 per win, 1 per draw)', () => {
    const standings = computeStandingsForFormat(
      'evolution_point_buy',
      ['a', 'b', 'c'],
      names,
      [
        { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
        { player_1_id: 'b', player_2_id: 'c', winner_id: null, round_number: 2 },
      ],
    );

    expect(standings[0].player_id).toBe('a');
    expect(standings[0].points).toBe(epbPack.matchPoints.win);
    expect(standings.find((s) => s.player_id === 'c')?.points).toBe(epbPack.matchPoints.draw);
    expect(epbPack.matchPoints).toEqual({ win: 3, draw: 1 });
  });

  it('keeps the generic tiebreakers for every other format', () => {
    for (const format of ['singles', 'doubles', 'draft', null, undefined]) {
      const standings = computeStandingsForFormat(
        format,
        ['a', 'b', 'c'],
        names,
        roundRobinTie,
        {},
        {},
        {},
        // Evolution points must be ignored for non-EPB formats
        { evolutionPoints: { a: 0, b: 3, c: 1 } },
      );

      expect(standings).toHaveLength(3);
      for (const s of standings) {
        expect('evolution_points' in s).toBe(false);
      }
    }
  });
});

describe('stored byes in the dispatcher', () => {
  const byes = [{ player_id: 'c', round_number: 1 }];

  it('leaves evolution_point_buy standings byte-identical: EPB ignores byes', () => {
    const run = (options: Parameters<typeof computeStandingsForFormat>[5]) =>
      computeStandingsForFormat(
        'evolution_point_buy',
        ['a', 'b', 'c'],
        names,
        roundRobinTie,
        {},
        options,
        {},
        { evolutionPoints: { a: 0, b: 3, c: 1 } },
      );

    const baseline = run({});
    expect(JSON.stringify(run({ byes }))).toBe(JSON.stringify(baseline));
    expect(JSON.stringify(run({ byes, pointsPerWin: 5 }))).toBe(JSON.stringify(run({ pointsPerWin: 5 })));
  });

  it('scores the bye in every other format that is handed the byes', () => {
    const standings = computeStandingsForFormat('singles', ['a', 'b', 'c'], names, [], {}, { byes });
    expect(standings[0].player_id).toBe('c');
    expect(standings[0].points).toBe(1);
  });
});

describe('stored tiebreaker order in the dispatcher', () => {
  // a beat b; c has played nobody but holds the most evolution points.
  const aBeatsB: MatchRecord[] = [{ player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 }];
  const evolutionPoints = { a: 0, b: 1, c: 10 };
  const order = (tiebreakerOrder?: unknown) =>
    computeStandingsForFormat('evolution_point_buy', ['a', 'b', 'c'], names, aBeatsB, {}, {}, {}, {
      evolutionPoints,
      tiebreakerOrder,
    }).map((s) => s.player_id);

  it('ranks an Evolution Point Buy season by the stored order, the pack chain without one', () => {
    expect(order()).toEqual(['a', 'c', 'b']);
    expect(order(['evolution_points', 'match_points'])).toEqual(['c', 'b', 'a']);
  });

  it('falls back to the pack chain for an order it cannot use', () => {
    expect(order([])).toEqual(order());
    expect(order(['nonsense'])).toEqual(order());
  });

  it('ignores a stored order for every other format', () => {
    for (const format of ['singles', 'doubles', 'draft', null]) {
      const ranked = (tiebreakerOrder?: unknown) =>
        computeStandingsForFormat(format, ['a', 'b', 'c'], names, aBeatsB, {}, {}, {}, {
          evolutionPoints,
          tiebreakerOrder,
        }).map((s) => s.player_id);
      expect(ranked(['evolution_points'])).toEqual(ranked());
    }
  });
});

describe('match points in the dispatcher', () => {
  const drawAndWin: MatchRecord[] = [
    { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    { player_1_id: 'b', player_2_id: 'c', winner_id: null, round_number: 2 },
  ];
  const points = (format: string, options: Parameters<typeof computeStandingsForFormat>[5]) =>
    Object.fromEntries(
      computeStandingsForFormat(format, ['a', 'b', 'c'], names, drawAndWin, {}, options).map((s) => [s.player_id, s.points]),
    );

  it('an Evolution Point Buy table scores the pack points whatever points the caller passes', () => {
    const pack = { a: epbPack.matchPoints.win, b: epbPack.matchPoints.draw, c: epbPack.matchPoints.draw };
    expect(points('evolution_point_buy', {})).toEqual(pack);
    expect(points('evolution_point_buy', { pointsPerWin: 3, pointsPerDraw: 0 })).toEqual(pack);
    expect(points('evolution_point_buy', { pointsPerWin: 50, pointsPerDraw: 40 })).toEqual(pack);
  });

  // Characterisation: every other league type scores exactly what its caller asks for.
  it.each(['singles', 'doubles', 'draft'])('%s: round robin 3 / 0, Swiss and the generic default 1 / 0.5', (format) => {
    expect(points(format, { pointsPerWin: 3, pointsPerDraw: 0 })).toEqual({ a: 3, b: 0, c: 0 });
    expect(points(format, {})).toEqual({ a: 1, b: 0.5, c: 0.5 });
  });
});

