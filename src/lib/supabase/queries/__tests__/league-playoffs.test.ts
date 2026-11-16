import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assembleLeagueSchedule } from '../league-standings';
import { leaguePlayoffsFixture } from '@/test/fixtures/league-playoffs';

beforeAll(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in standings fixture tests'); })));
afterAll(() => vi.unstubAllGlobals());

function schedule(playoffs: boolean) {
  return assembleLeagueSchedule(leaguePlayoffsFixture(playoffs));
}

describe('league tables with playoffs', () => {
  it('keeps group tables and the combined table unchanged by playoff results', () => {
    const before = schedule(false);
    const after = schedule(true);
    expect(after.standings).toEqual(before.standings);
    expect(after.groupStandings).toEqual(before.groupStandings);
    expect(after.fixtures).toHaveLength(8);
  });

  it('places the playoff winner first, the runner-up second, and both semifinal losers third', () => {
    const result = schedule(true);
    expect(result.finalPlacings?.slice(0, 4).map((row) => [row.player_id, row.rank])).toEqual([
      ['Orbit', 1], ['Nova', 2], ['Comet', 3], ['Meteor', 3],
    ]);
    expect(result.finalPlacings?.slice(4).map((row) => row.player_id)).toEqual(
      result.standings.filter((row) => ['Pulsar', 'Quasar'].includes(row.player_id)).map((row) => row.player_id),
    );
  });

  it('does not add a separate final table to a league without playoffs', () => {
    expect(schedule(false)).not.toHaveProperty('finalPlacings');
  });
});
