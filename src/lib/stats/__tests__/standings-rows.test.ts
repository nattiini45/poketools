import { describe, expect, it } from 'vitest';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import type { KitStandingsData } from '@/lib/format-engine/context';
import { buildStandingsRowsFromMatchRecords, rankingForPhase } from '../standings-rows';

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

describe('rankingForPhase', () => {
  const stage = { key: 'main', scoring: { win: 3, draw: 1, loss: 0, bye: 3 }, rank: [] } as never;
  const kit: KitStandingsData = {
    engine: 'kit',
    stages: { 'phase-a': stage, 'phase-b': stage },
    stageOfMatch: { m1: 'phase-a' },
    outcomes: {},
    coinFlips: {},
  };
  const ranking = { formatType: 'custom', kit } as unknown as SeasonStandingsContext;

  it('narrows the kit data to the one phase, even when it has no completed match yet', () => {
    expect(Object.keys(rankingForPhase(ranking, 'phase-b')!.kit!.stages)).toEqual(['phase-b']);
  });

  it('leaves a context without kit data, and no context, as they are', () => {
    const plain = { formatType: 'swiss' } as unknown as SeasonStandingsContext;
    expect(rankingForPhase(plain, 'phase-a')).toBe(plain);
    expect(rankingForPhase(undefined, 'phase-a')).toBeUndefined();
  });
});
