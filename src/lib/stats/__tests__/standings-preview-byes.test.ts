import { beforeEach, describe, expect, it, vi } from 'vitest';

// The league card and the tournament card of the standings preview score a Swiss stage's stored byes alike.

const h = vi.hoisted(() => ({
  getSeasonParticipants: vi.fn(),
  getSeasonStageBrackets: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
  getCompletedMatchRecordsBatch: vi.fn(),
  getParticipants: vi.fn(),
  getTournamentById: vi.fn(),
  loadScoringByes: vi.fn(),
  loadSeasonSwissByeRounds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: h.getSeasonParticipants,
  getSeasonStageBrackets: h.getSeasonStageBrackets,
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: h.getCompletedMatchRecords,
  getCompletedMatchRecordsBatch: h.getCompletedMatchRecordsBatch,
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getParticipants: h.getParticipants,
  getTournamentById: h.getTournamentById,
}));
vi.mock('@/lib/tournament/scoring-byes', () => ({
  loadScoringByes: h.loadScoringByes,
  loadSeasonSwissByeRounds: h.loadSeasonSwissByeRounds,
}));

import { getStandingsPreview } from '../standings-preview';

const players = ['a', 'b', 'e'].map((id) => ({ id, name: id, avatar_url: null, gym_type: null }));
const aBeatsB = [{ player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 }];

function byeRound(id: string, tournament_id: string, round_number: number, bye_player_ids: string[]) {
  return { id, tournament_id, round_number, bye_player_ids };
}

beforeEach(() => {
  for (const mock of Object.values(h)) mock.mockReset();
  h.getSeasonParticipants.mockResolvedValue(players);
  h.getSeasonStageBrackets.mockResolvedValue({
    stageIds: ['swiss-1', 'rr-1'],
    hasSwissStage: true,
    formatType: 'singles',
  });
  h.getCompletedMatchRecordsBatch.mockResolvedValue(new Map([['swiss-1', aBeatsB]]));
  h.loadSeasonSwissByeRounds.mockResolvedValue(new Map([['swiss-1', [byeRound('r1', 'swiss-1', 1, ['e'])]]]));
});

describe('getStandingsPreview (league) with Swiss stage byes', () => {
  it('scores the byes of the Swiss stages, so the league card agrees with the stage tables', async () => {
    const rows = await getStandingsPreview('league', 'season-1', 3);

    expect(h.loadSeasonSwissByeRounds).toHaveBeenCalledTimes(1);
    expect(h.loadSeasonSwissByeRounds).toHaveBeenCalledWith('season-1');
    const eve = rows.find((r) => r.player_id === 'e')!;
    expect(eve).toMatchObject({ wins: 1, losses: 0 });
    expect(rows.map((r) => r.player_id)).toEqual(['a', 'e', 'b']);
  });

  it('leaves the table unchanged for rounds that store no bye (historic standings)', async () => {
    h.loadSeasonSwissByeRounds.mockResolvedValue(new Map([['swiss-1', [byeRound('r1', 'swiss-1', 1, [])]]]));

    const rows = await getStandingsPreview('league', 'season-1', 3);

    expect(rows.find((r) => r.player_id === 'e')).toMatchObject({ wins: 0, losses: 0 });
  });

  it('reads no rounds and scores no bye for an Evolution Point Buy league', async () => {
    h.getSeasonStageBrackets.mockResolvedValue({
      stageIds: ['swiss-1', 'rr-1'],
      hasSwissStage: true,
      formatType: 'evolution_point_buy',
    });

    const rows = await getStandingsPreview('league', 'season-1', 3);

    expect(h.loadSeasonSwissByeRounds).not.toHaveBeenCalled();
    expect(rows.find((r) => r.player_id === 'e')).toMatchObject({ wins: 0, losses: 0 });
  });

  it('reads no rounds for a league without a Swiss stage', async () => {
    h.getSeasonStageBrackets.mockResolvedValue({
      stageIds: ['rr-1', 'rr-2'],
      hasSwissStage: false,
      formatType: 'singles',
    });

    const rows = await getStandingsPreview('league', 'season-1', 3);

    expect(h.loadSeasonSwissByeRounds).not.toHaveBeenCalled();
    expect(h.getCompletedMatchRecordsBatch).toHaveBeenCalledWith(['rr-1', 'rr-2']);
    expect(rows.find((r) => r.player_id === 'e')).toMatchObject({ wins: 0, losses: 0 });
  });

  it('reads the season once for the stage ids, the Swiss flag and the format (no separate season read)', async () => {
    await getStandingsPreview('league', 'season-1', 3);

    expect(h.getSeasonStageBrackets).toHaveBeenCalledTimes(1);
    expect(h.getSeasonStageBrackets).toHaveBeenCalledWith('season-1');
  });

  it('rejects when the bye read fails instead of caching a table without its byes', async () => {
    const failure = new Error('rounds unavailable');
    h.loadSeasonSwissByeRounds.mockRejectedValue(failure);

    await expect(getStandingsPreview('league', 'season-1', 3)).rejects.toBe(failure);
  });
});

describe('getStandingsPreview (tournament)', () => {
  it('scores the tournament byes with the same rule', async () => {
    h.getParticipants.mockResolvedValue(players);
    h.getCompletedMatchRecords.mockResolvedValue(aBeatsB);
    h.getTournamentById.mockResolvedValue({ id: 'swiss-1', bracket_type: 'swiss' });
    h.loadScoringByes.mockResolvedValue([{ player_id: 'e', round_number: 1 }]);

    const rows = await getStandingsPreview('tournament', 'swiss-1', 3);

    expect(rows.find((r) => r.player_id === 'e')).toMatchObject({ wins: 1, losses: 0 });
  });
});
