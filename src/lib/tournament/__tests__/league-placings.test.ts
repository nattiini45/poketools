import { describe, expect, it } from 'vitest';
import { finalLeaguePlacings, groupStageRanking, playoffRanks, playoffStandingsOptions, type PlayoffRecord } from '../league-placings';
import type { SeasonStandingsContext } from '../season-standings';
import { computeStandingsFromContext } from '../season-standings';

const stage = { id: 'playoffs', bracket_type: 'single_elim', participant_count: 8 };
const record = (round: number, a: string, b: string, winner: string, position = 0): PlayoffRecord => ({
  round_number: round, player_1_id: a, player_2_id: b, winner_id: winner, bracket_pos: position,
});
const quarterfinals = [record(1, 'Comet', 'Meteor', 'Meteor'), record(1, 'Nova', 'Orbit', 'Nova', 1),
  record(1, 'Pulsar', 'Quasar', 'Pulsar', 2), record(1, 'Rocket', 'Solar', 'Solar', 3)];
const semifinals = [record(2, 'Meteor', 'Nova', 'Nova'), record(2, 'Pulsar', 'Solar', 'Pulsar', 1)];
const final = record(3, 'Nova', 'Pulsar', 'Pulsar');

describe('bracket places, not points across phases', () => {
  it('excludes playoff-only kit adjustments from a merged group-stage table', () => {
    const rules = { key: 'table', scoring: { win: 3, loss: 0, bye: 0 }, rank: [] };
    const context: SeasonStandingsContext = { formatType: 'custom', kit: {
      engine: 'kit', stages: { first: rules, second: rules, playoffs: rules },
      stageOfMatch: { first: 'first', second: 'second' }, outcomes: {}, coinFlips: {},
      adjustments: { first: { Comet: 1 }, playoffs: { Nova: 100 } },
    } };
    const ranking = groupStageRanking(context, [{ id: 'first', bracket_type: 'swiss' },
      { id: 'second', bracket_type: 'swiss' }, stage]);
    const matches = [{ ...record(1, 'Comet', 'Nova', 'Comet'), match_id: 'first' },
      { ...record(1, 'Comet', 'Nova', 'Nova'), match_id: 'second' }];
    const table = computeStandingsFromContext(ranking, ['Comet', 'Nova'], {}, matches);
    expect(table.map((row) => [row.player_id, row.points])).toEqual([['Comet', 4], ['Nova', 3]]);
    expect(context.kit?.adjustments?.playoffs).toEqual({ Nova: 100 });
  });
  it('gives larger single-elimination rounds shared third and fifth places', () => {
    const ranks = playoffRanks(stage, [...quarterfinals, ...semifinals, final]);
    expect([...ranks.values()]).toEqual([1, 2, 3, 3, 5, 5, 5, 5]);
    expect(ranks.get('Pulsar')).toBe(1);
  });

  it('does not crown a semifinal winner or a lone preliminary winner', () => {
    expect(playoffRanks(stage, [...quarterfinals, ...semifinals]).size).toBe(0);
    expect(playoffRanks(stage, quarterfinals.slice(0, 1)).size).toBe(0);
  });

  it('uses the loaded enrollment when a tournament row carries no participant count', () => {
    const options = playoffStandingsOptions({ id: 'playoffs', bracket_type: 'single_elim' }, 8);
    expect(playoffRanks(options.playoffStage!, quarterfinals.slice(0, 1)).size).toBe(0);
  });

  it('uses a recorded third-place match when one exists', () => {
    const ranks = playoffRanks({ ...stage, third_place_enabled: true },
      [...quarterfinals, ...semifinals, final, record(3, 'Meteor', 'Solar', 'Solar', 1)]);
    expect(ranks.get('Solar')).toBe(3);
    expect(ranks.get('Meteor')).toBe(4);
  });

  it('handles a three-player bracket with a bye without inventing a fourth place', () => {
    const ranks = playoffRanks({ ...stage, participant_count: 3 }, [record(1, 'Comet', 'Nova', 'Nova'), record(2, 'Meteor', 'Nova', 'Meteor')]);
    expect([...ranks]).toEqual([['Meteor', 1], ['Nova', 2], ['Comet', 3]]);
  });

  it('places two independent five-player brackets in stage order after both finals', () => {
    const upper = { ...stage, id: 'upper', participant_count: 5 };
    const lower = { ...upper, id: 'lower' };
    const upperRecords = [
      record(1, '4', '5', '5'), record(2, '1', '5', '5'), record(2, '2', '3', '3', 1), record(3, '5', '3', '5'),
    ];
    const lowerRecords = [
      record(1, '9', '10', '10'), record(2, '6', '10', '10'), record(2, '7', '8', '8', 1), record(3, '10', '8', '10'),
    ];
    const table = Array.from({ length: 10 }, (_, i) => ({ player_id: String(i + 1), points: 10 - i }));
    const records = new Map([[upper.id, upperRecords], [lower.id, lowerRecords.slice(0, -1)]]);
    expect(finalLeaguePlacings(table, [upper, lower], records)).toBeUndefined();
    records.set(lower.id, lowerRecords);
    const placings = finalLeaguePlacings(table, [upper, lower], records);
    expect(placings?.map(({ player_id, rank }) => [player_id, rank])).toEqual([
      ['5', 1], ['3', 2], ['1', 3], ['2', 3], ['4', 5],
      ['10', 6], ['8', 7], ['6', 8], ['7', 8], ['9', 10],
    ]);
  });

  it('keeps non-qualifiers in the original group-table order, without mutating the table', () => {
    const table = ['Rocket', 'Comet', 'Pulsar', 'Nova', 'Meteor', 'Orbit', 'Quasar', 'Solar', 'Zenith', 'Asteroid']
      .map((player_id) => ({ player_id, points: 3 }));
    const before = structuredClone(table);
    const result = finalLeaguePlacings(table, [stage], new Map([[stage.id, [...quarterfinals, ...semifinals, final]]]))!;
    expect(result.slice(-2).map((row) => [row.player_id, row.rank])).toEqual([['Zenith', 9], ['Asteroid', 10]]);
    expect(table).toEqual(before);
  });

  it('waits for a required double-elimination reset instead of crowning the first final winner', () => {
    const double = { id: 'double', bracket_type: 'double_elim' };
    const records: PlayoffRecord[] = [
      { ...record(1, 'Comet', 'Nova', 'Comet'), bracket_side: 'winners' },
      { ...record(2, 'Comet', 'Nova', 'Nova'), bracket_side: 'grand_finals' },
    ];
    expect(playoffRanks(double, records).size).toBe(0);
    expect(playoffRanks({ ...double, bracket_reset_enabled: false }, records).get('Nova')).toBe(1);
    records.push({ ...record(2, 'Comet', 'Nova', 'Comet', 1), bracket_side: 'grand_finals' });
    expect([...playoffRanks(double, records)]).toEqual([['Comet', 1], ['Nova', 2]]);
  });

  it('ranks a larger double-elimination bracket by losers-bracket elimination rounds', () => {
    const losers = [record(2, 'Meteor', 'Quasar', 'Meteor'), record(2, 'Orbit', 'Solar', 'Orbit'),
      record(4, 'Pulsar', 'Meteor', 'Pulsar'), record(4, 'Rocket', 'Orbit', 'Rocket'),
      record(5, 'Rocket', 'Pulsar', 'Rocket'), record(7, 'Rocket', 'Nova', 'Rocket')]
      .map((row) => ({ ...row, bracket_side: 'losers' as const }));
    const records: PlayoffRecord[] = [
      { ...record(6, 'Comet', 'Nova', 'Comet'), bracket_side: 'winners' },
      ...losers, { ...record(8, 'Comet', 'Rocket', 'Comet'), bracket_side: 'grand_finals' },
    ];
    const ranks = playoffRanks({ id: 'double', bracket_type: 'double_elim' }, records);
    expect([...ranks.values()]).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
    expect(ranks.get('Nova')).toBe(3);
  });

  it('does not wait for an unnecessary reset, including a losers-bracket starter with no recorded earlier loss', () => {
    const records: PlayoffRecord[] = [
      { ...record(2, 'Comet', 'Nova', 'Comet'), bracket_side: 'grand_finals' },
      { ...record(2, 'Comet', 'Nova', 'Comet', 1), bracket_side: 'grand_finals', winner_id: null },
    ];
    expect([...playoffRanks({ id: 'double', bracket_type: 'double_elim' }, records)])
      .toEqual([['Comet', 1], ['Nova', 2]]);
  });
});
