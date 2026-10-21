import { describe, expect, it } from 'vitest';
import {
  combinedRanking,
  groupTablesUpToWeek,
  matchesPlayed,
  pointsPerMatch,
  rankCombinedTable,
  splitGroupTables,
} from '../group-standings';
import { computeStandings } from '../standings';
import type { MatchRecord, Standing } from '../types';

function row(id: string, wins: number, losses: number, draws = 0, points = wins * 3 + draws): Standing {
  return {
    player_id: id,
    player_name: id,
    player_avatar_url: null,
    gym_type: null,
    wins,
    losses,
    draws,
    points,
    buchholz: 0,
    games_played: 0,
    kill_differential: 0,
    eliminated: false,
  };
}

const groups = [
  { id: 'ga', name: 'Gold', playerIds: ['a1', 'a2', 'a3'] },
  { id: 'gb', name: 'Silver', playerIds: ['b1', 'b2'] },
];

describe('group tables', () => {
  it('splits a full table per group, keeping its order (tiebreaks unchanged)', () => {
    const table = [row('b1', 3, 0), row('a2', 2, 1), row('a1', 2, 1), row('b2', 1, 2), row('a3', 0, 3)];
    const split = splitGroupTables(table, groups);
    expect(split.map((t) => t.group.id)).toEqual(['ga', 'gb']);
    expect(split[0].standings.map((r) => r.player_id)).toEqual(['a2', 'a1', 'a3']);
    expect(split[1].standings.map((r) => r.player_id)).toEqual(['b1', 'b2']);
  });

  it('counts cross-group matches in the group tables (one table over every trainer, then split)', () => {
    const matches: MatchRecord[] = [
      { player_1_id: 'a1', player_2_id: 'a2', winner_id: 'a1', round_number: 1 },
      { player_1_id: 'a3', player_2_id: 'b1', winner_id: 'a3', round_number: 1 }, // cross
      { player_1_id: 'b1', player_2_id: 'b2', winner_id: 'b2', round_number: 2 },
      { player_1_id: 'a2', player_2_id: 'b2', winner_id: 'a2', round_number: 3 }, // cross, after the cut
    ];
    const tables = groupTablesUpToWeek({
      groups,
      matches,
      lastWeek: 2,
      computeTable: (ids, records) => computeStandings(ids, {}, records, {}, { pointsPerWin: 3, pointsPerDraw: 0 }),
    });
    const gold = tables.get('ga')!;
    expect(gold.find((r) => r.player_id === 'a3')!.wins).toBe(1); // the cross win counts
    expect(gold.find((r) => r.player_id === 'a2')!.wins).toBe(0); // week 3 is after the cut
    expect(gold.map((r) => r.player_id)).toEqual(['a1', 'a3', 'a2']);
    expect(tables.get('gb')!.map((r) => r.player_id)).toEqual(['b2', 'b1']);
  });
});

describe('combined table', () => {
  it('keeps the points order while every trainer has played as many matches', () => {
    const table = [row('a1', 2, 0), row('b1', 1, 1), row('a2', 0, 2)];
    expect(combinedRanking(table)).toBe('points');
    expect(rankCombinedTable(table)).toEqual({ ranking: 'points', standings: table });
  });

  it('ranks by points per match when match counts differ (unequal groups)', () => {
    // a1: 9 points in 4 matches (2.25); b1: 7 in 3 (2.33); a2: 6 in 4 (1.5); b2: 0 in 3.
    const table = [row('a1', 3, 1), row('b1', 2, 0, 1, 7), row('a2', 2, 2), row('b2', 0, 3)];
    expect(combinedRanking(table)).toBe('points_per_match');
    const { ranking, standings } = rankCombinedTable(table);
    expect(ranking).toBe('points_per_match');
    expect(standings.map((r) => r.player_id)).toEqual(['b1', 'a1', 'a2', 'b2']);
  });

  it('breaks equal points per match by the full table order', () => {
    const table = [row('x', 2, 2), row('y', 1, 1), row('z', 0, 0)]; // 1.5, 1.5, 0
    expect(rankCombinedTable(table).standings.map((r) => r.player_id)).toEqual(['x', 'y', 'z']);
  });

  it('counts matches and points per match', () => {
    expect(matchesPlayed(row('p', 2, 1, 1))).toBe(4);
    expect(pointsPerMatch(row('p', 2, 1, 1))).toBeCloseTo(7 / 4);
    expect(pointsPerMatch(row('p', 0, 0))).toBe(0);
  });
});
