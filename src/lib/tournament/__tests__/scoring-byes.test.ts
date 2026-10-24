import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getRoundsByTournament: vi.fn(),
  getByeRoundsByTournamentIds: vi.fn(),
  getSwissByeRoundsBySeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => h);

import { loadScoringByes, loadScoringByesBatch, loadSeasonSwissByeRounds } from '../scoring-byes';

function byeRound(id: string, tournament_id: string, round_number: number, bye_player_ids: string[]) {
  return { id, tournament_id, round_number, bye_player_ids };
}

beforeEach(() => {
  h.getRoundsByTournament.mockReset();
  h.getByeRoundsByTournamentIds.mockReset();
  h.getSwissByeRoundsBySeason.mockReset();
});

describe('loadScoringByesBatch', () => {
  it('reads the rounds of all Swiss tournaments in ONE call and gives every tournament an entry', async () => {
    h.getByeRoundsByTournamentIds.mockResolvedValue(
      new Map([
        ['swiss-1', [byeRound('r1', 'swiss-1', 1, ['p1'])]],
        ['swiss-2', [byeRound('r2', 'swiss-2', 3, ['p2', 'p3'])]],
      ]),
    );

    const byes = await loadScoringByesBatch([
      { id: 'swiss-1', bracket_type: 'swiss' },
      { id: 'rr-1', bracket_type: 'round_robin' },
      { id: 'swiss-2', bracket_type: 'swiss' },
      { id: 'untyped' },
    ]);

    expect(h.getByeRoundsByTournamentIds).toHaveBeenCalledTimes(1);
    expect(h.getByeRoundsByTournamentIds).toHaveBeenCalledWith(['swiss-1', 'swiss-2']);
    expect(h.getRoundsByTournament).not.toHaveBeenCalled();
    expect(byes.get('swiss-1')).toEqual([{ player_id: 'p1', round_number: 1 }]);
    expect(byes.get('swiss-2')).toEqual([
      { player_id: 'p2', round_number: 3 },
      { player_id: 'p3', round_number: 3 },
    ]);
    expect(byes.get('rr-1')).toEqual([]);
    expect(byes.get('untyped')).toEqual([]);
  });

  it('reads no round when there is no Swiss tournament', async () => {
    const byes = await loadScoringByesBatch([
      { id: 'rr-1', bracket_type: 'round_robin' },
      { id: 'se-1', bracket_type: 'single_elim' },
    ]);

    expect(h.getByeRoundsByTournamentIds).not.toHaveBeenCalled();
    expect([...byes.values()]).toEqual([[], []]);
  });

  it('gives a Swiss tournament with no stored bye an empty entry (legacy rounds)', async () => {
    h.getByeRoundsByTournamentIds.mockResolvedValue(new Map([['swiss-1', [byeRound('r1', 'swiss-1', 1, [])]]]));

    const byes = await loadScoringByesBatch([{ id: 'swiss-1', bracket_type: 'swiss' }]);

    expect(byes.get('swiss-1')).toEqual([]);
  });
});

describe('loadSeasonSwissByeRounds', () => {
  it('groups the one season read by stage id', async () => {
    h.getSwissByeRoundsBySeason.mockResolvedValue([
      byeRound('r1', 'swiss-1', 1, ['p1']),
      byeRound('r2', 'swiss-1', 2, []),
      byeRound('r3', 'swiss-2', 1, ['p2']),
    ]);

    const byStage = await loadSeasonSwissByeRounds('season-1');

    expect(h.getSwissByeRoundsBySeason).toHaveBeenCalledTimes(1);
    expect(h.getSwissByeRoundsBySeason).toHaveBeenCalledWith('season-1');
    expect(byStage.get('swiss-1')?.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(byStage.get('swiss-2')?.map((r) => r.id)).toEqual(['r3']);
  });

  it('is empty for a season without Swiss rounds', async () => {
    h.getSwissByeRoundsBySeason.mockResolvedValue([]);

    expect((await loadSeasonSwissByeRounds('season-1')).size).toBe(0);
  });
});

describe('loadScoringByes', () => {
  it('still reads no round for a tournament that is not Swiss', async () => {
    expect(await loadScoringByes({ id: 'rr-1', bracket_type: 'round_robin' })).toEqual([]);
    expect(h.getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('reads no round and scores no bye for a Swiss stage of an Evolution Point Buy league', async () => {
    const byes = await loadScoringByes({
      id: 'swiss-1',
      bracket_type: 'swiss',
      season_format_type: 'evolution_point_buy',
    });

    expect(byes).toEqual([]);
    expect(h.getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('scores the Swiss byes of a standalone tournament and of another league format', async () => {
    h.getRoundsByTournament.mockResolvedValue([byeRound('r1', 'swiss-1', 2, ['p1'])]);

    for (const season_format_type of [null, undefined, 'standard']) {
      const byes = await loadScoringByes({ id: 'swiss-1', bracket_type: 'swiss', season_format_type });
      expect(byes).toEqual([{ player_id: 'p1', round_number: 2 }]);
    }
  });
});

describe('loadScoringByesBatch with Evolution Point Buy stages', () => {
  it('leaves an Evolution Point Buy stage out of the rounds read and gives it an empty entry', async () => {
    h.getByeRoundsByTournamentIds.mockResolvedValue(new Map([['swiss-1', [byeRound('r1', 'swiss-1', 1, ['p1'])]]]));

    const byes = await loadScoringByesBatch([
      { id: 'swiss-1', bracket_type: 'swiss', season_format_type: 'standard' },
      { id: 'swiss-epb', bracket_type: 'swiss', season_format_type: 'evolution_point_buy' },
    ]);

    expect(h.getByeRoundsByTournamentIds).toHaveBeenCalledWith(['swiss-1']);
    expect(byes.get('swiss-1')).toEqual([{ player_id: 'p1', round_number: 1 }]);
    expect(byes.get('swiss-epb')).toEqual([]);
  });
});
