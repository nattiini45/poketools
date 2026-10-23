import { describe, expect, it } from 'vitest';
import { buildStandingsRowsFromMatchRecords } from '../standings-rows';

const participants = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), avatar_url: null }));
const records = [{ player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 }];

describe('buildStandingsRowsFromMatchRecords with stored Swiss byes', () => {
  it('counts a bye as a win for the player who sat out', () => {
    const rows = buildStandingsRowsFromMatchRecords(participants, records, [{ player_id: 'c', round_number: 1 }]);

    expect(rows.find((r) => r.player_id === 'c')).toMatchObject({ wins: 1, losses: 0 });
  });

  it('is unchanged without byes', () => {
    expect(buildStandingsRowsFromMatchRecords(participants, records, [])).toEqual(
      buildStandingsRowsFromMatchRecords(participants, records),
    );
    const rows = buildStandingsRowsFromMatchRecords(participants, records);
    expect(rows.find((r) => r.player_id === 'c')).toMatchObject({ wins: 0, losses: 0 });
  });
});
