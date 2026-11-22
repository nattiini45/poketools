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
  getSeasonEvolutionPoints: vi.fn(),
  getFormatRules: vi.fn(),
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
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getSeasonEvolutionPoints: h.getSeasonEvolutionPoints }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: h.getFormatRules,
  getTiebreakerOrdersBySeason: vi.fn(),
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
  h.getSeasonEvolutionPoints.mockResolvedValue({});
  h.getFormatRules.mockResolvedValue(null);
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

describe('getStandingsPreview ranking of an Evolution Point Buy league', () => {
  // a beat b; e has played nobody but holds the most evolution points.
  beforeEach(() => {
    h.getSeasonStageBrackets.mockResolvedValue({
      stageIds: ['rr-1'],
      hasSwissStage: false,
      formatType: 'evolution_point_buy',
    });
    h.getCompletedMatchRecordsBatch.mockResolvedValue(new Map([['rr-1', aBeatsB]]));
    h.getSeasonEvolutionPoints.mockResolvedValue({ a: 0, b: 1, e: 10 });
  });

  const ranked = async (kind: 'league' | 'tournament' = 'league') =>
    (await getStandingsPreview(kind, kind === 'league' ? 'season-1' : 'rr-1', 3)).map((r) => r.player_id);

  it('ranks the league card by the stored tiebreaker order', async () => {
    h.getFormatRules.mockResolvedValue({ tiebreaker_order: ['evolution_points', 'match_points'] });

    expect(await ranked()).toEqual(['e', 'b', 'a']);
  });

  it('falls back to the format pack chain without a rules row or with an order it cannot use', async () => {
    expect(await ranked()).toEqual(['a', 'e', 'b']);

    h.getFormatRules.mockResolvedValue({ tiebreaker_order: ['evolution_points', 'evolution_points'] });
    expect(await ranked()).toEqual(['a', 'e', 'b']);
  });

  it('ranks the card of a phase of the league the same way', async () => {
    h.getFormatRules.mockResolvedValue({ tiebreaker_order: ['evolution_points', 'match_points'] });
    h.getParticipants.mockResolvedValue(players);
    h.getCompletedMatchRecords.mockResolvedValue(aBeatsB);
    h.getTournamentById.mockResolvedValue({
      id: 'rr-1',
      bracket_type: 'round_robin',
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    });
    h.loadScoringByes.mockResolvedValue([]);

    expect(await ranked('tournament')).toEqual(['e', 'b', 'a']);
    expect(h.getFormatRules).toHaveBeenCalledWith('season-1');
  });

  it('reads the rules and evolution points of no other league format', async () => {
    h.getSeasonStageBrackets.mockResolvedValue({ stageIds: ['rr-1'], hasSwissStage: false, formatType: 'singles' });

    await ranked();

    expect(h.getFormatRules).not.toHaveBeenCalled();
    expect(h.getSeasonEvolutionPoints).not.toHaveBeenCalled();
  });
});
