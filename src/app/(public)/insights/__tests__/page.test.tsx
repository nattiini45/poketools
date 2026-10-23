import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Insights standings score a Swiss stage's stored byes in the league scope as they do in the tournament scope.

const h = vi.hoisted(() => ({
  publicReads: {
    seasonList: vi.fn(),
    tournamentList: vi.fn(),
    ratingLeaderboard: vi.fn(),
    streakLeaderboard: vi.fn(),
    aggregatesSummary: vi.fn(),
    totalGames: vi.fn(),
    season: vi.fn(),
    seasonStages: vi.fn(),
    seasonParticipants: vi.fn(),
    seasonBattleStats: vi.fn(),
    seasonByeRounds: vi.fn(),
    seasonMatchRecords: vi.fn(),
    tournament: vi.fn(),
    tournamentParticipants: vi.fn(),
    tournamentMatchRecords: vi.fn(),
    tournamentBattleStats: vi.fn(),
    tournamentRounds: vi.fn(),
  },
}));

vi.mock('@/lib/cache/public-reads', () => ({ publicReads: h.publicReads }));
vi.mock('@/lib/pack-extensions', () => ({
  loadSupplement: vi.fn(),
  packExtensions: { supplementaryKillRanking: undefined },
}));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/components/shared/ScopeSelector', () => ({ default: () => null }));
vi.mock('@/components/insights/InsightsTabs', () => ({ default: () => null }));

import InsightsPage from '../page';
import InsightsTabs from '@/components/insights/InsightsTabs';

interface StandingsRowView {
  player_id: string;
  wins: number;
  losses: number;
}

/** Renders the page for a scope and returns the standings rows handed to the client tabs. */
async function renderStandings(searchParams: Record<string, string>): Promise<StandingsRowView[]> {
  const suspense = (await InsightsPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    children: ReactElement;
  }>;
  const content = suspense.props.children as ReactElement<Record<string, unknown>> & {
    type: (props: Record<string, unknown>) => Promise<ReactElement<{ children: ReactElement[] }>>;
  };
  const page = await content.type(content.props);
  const tabs = page.props.children.find((child) => child.type === InsightsTabs) as ReactElement<{
    standings: StandingsRowView[];
  }>;
  return tabs.props.standings;
}

const players = ['a', 'b', 'e'].map((id) => ({ id, name: id, avatar_url: null, gym_type: null }));
const aBeatsB = [{ player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 }];
const byeRounds = [{ id: 'r1', tournament_id: 'swiss-1', round_number: 1, bye_player_ids: ['e'], status: 'pending' }];

function eve(rows: StandingsRowView[]) {
  return rows.find((row) => row.player_id === 'e');
}

beforeEach(() => {
  for (const read of Object.values(h.publicReads)) read.mockReset();
  const reads = h.publicReads;
  reads.seasonList.mockResolvedValue([]);
  reads.tournamentList.mockResolvedValue([]);
  reads.ratingLeaderboard.mockResolvedValue([]);
  reads.streakLeaderboard.mockResolvedValue([]);
  reads.aggregatesSummary.mockResolvedValue([]);
  reads.totalGames.mockResolvedValue(0);
  reads.seasonParticipants.mockResolvedValue(players);
  reads.seasonBattleStats.mockResolvedValue([]);
  reads.seasonMatchRecords.mockResolvedValue(aBeatsB);
  reads.tournamentParticipants.mockResolvedValue(players);
  reads.tournamentMatchRecords.mockResolvedValue(aBeatsB);
  reads.tournamentBattleStats.mockResolvedValue([]);
  reads.tournamentRounds.mockResolvedValue(byeRounds);
  reads.seasonByeRounds.mockResolvedValue(byeRounds);
  reads.season.mockResolvedValue({ id: 'season-1', name: 'League', format_type: 'standard' });
  reads.seasonStages.mockResolvedValue([
    { id: 'swiss-1', bracket_type: 'swiss' },
    { id: 'rr-1', bracket_type: 'round_robin' },
  ]);
  reads.tournament.mockResolvedValue({ id: 'swiss-1', name: 'Swiss', bracket_type: 'swiss', is_doubles: false });
});

describe('Insights standings', () => {
  it('league scope scores the Swiss stage byes, agreeing with the tournament scope', async () => {
    const league = await renderStandings({ scope: 'league', id: 'season-1' });
    const tournament = await renderStandings({ scope: 'tournament', id: 'swiss-1' });

    expect(eve(tournament)).toMatchObject({ wins: 1, losses: 0 });
    expect(eve(league)).toMatchObject({ wins: 1, losses: 0 });
  });

  it('tournament scope scores no bye for a Swiss stage of an Evolution Point Buy league, agreeing with the league scope', async () => {
    h.publicReads.season.mockResolvedValue({ id: 'season-1', name: 'League', format_type: 'evolution_point_buy' });
    h.publicReads.tournament.mockResolvedValue({
      id: 'swiss-1',
      name: 'Swiss',
      bracket_type: 'swiss',
      is_doubles: false,
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    });

    const league = await renderStandings({ scope: 'league', id: 'season-1' });
    const tournament = await renderStandings({ scope: 'tournament', id: 'swiss-1' });

    expect(eve(league)).toMatchObject({ wins: 0, losses: 0 });
    expect(eve(tournament)).toMatchObject({ wins: 0, losses: 0 });
    expect(h.publicReads.tournamentRounds).not.toHaveBeenCalled();
  });

  it('tournament scope still scores the bye of a Swiss stage of another league format', async () => {
    h.publicReads.tournament.mockResolvedValue({
      id: 'swiss-1',
      name: 'Swiss',
      bracket_type: 'swiss',
      is_doubles: false,
      season_id: 'season-1',
      season_format_type: 'standard',
    });

    const tournament = await renderStandings({ scope: 'tournament', id: 'swiss-1' });

    expect(eve(tournament)).toMatchObject({ wins: 1, losses: 0 });
  });

  it('league scope reads the Swiss stages bye rounds in ONE batched read, not one per stage', async () => {
    h.publicReads.seasonStages.mockResolvedValue([
      { id: 'swiss-1', bracket_type: 'swiss' },
      { id: 'swiss-2', bracket_type: 'swiss' },
      { id: 'rr-1', bracket_type: 'round_robin' },
    ]);
    h.publicReads.seasonByeRounds.mockResolvedValue([
      ...byeRounds,
      { id: 'r2', tournament_id: 'swiss-2', round_number: 1, bye_player_ids: ['a'], status: 'pending' },
    ]);

    const league = await renderStandings({ scope: 'league', id: 'season-1' });

    expect(h.publicReads.seasonByeRounds).toHaveBeenCalledTimes(1);
    expect(h.publicReads.seasonByeRounds).toHaveBeenCalledWith('season-1');
    expect(h.publicReads.tournamentRounds).not.toHaveBeenCalled();
    expect(eve(league)).toMatchObject({ wins: 1, losses: 0 });
    expect(league.find((row) => row.player_id === 'a')).toMatchObject({ wins: 2, losses: 0 });
  });

  it('a bye round of a stage that is not Swiss never scores', async () => {
    h.publicReads.seasonByeRounds.mockResolvedValue([
      { id: 'r9', tournament_id: 'rr-1', round_number: 1, bye_player_ids: ['e'], status: 'pending' },
    ]);

    const league = await renderStandings({ scope: 'league', id: 'season-1' });

    expect(eve(league)).toMatchObject({ wins: 0, losses: 0 });
  });

  it('league scope is unchanged for rounds that store no bye (historic standings)', async () => {
    h.publicReads.seasonByeRounds.mockResolvedValue([{ ...byeRounds[0], bye_player_ids: [] }]);

    const league = await renderStandings({ scope: 'league', id: 'season-1' });

    expect(eve(league)).toMatchObject({ wins: 0, losses: 0 });
  });

  it('league scope reads no rounds and scores no bye for an Evolution Point Buy league', async () => {
    h.publicReads.season.mockResolvedValue({ id: 'season-1', name: 'League', format_type: 'evolution_point_buy' });

    const league = await renderStandings({ scope: 'league', id: 'season-1' });

    expect(h.publicReads.seasonByeRounds).not.toHaveBeenCalled();
    expect(eve(league)).toMatchObject({ wins: 0, losses: 0 });
  });

  it('league scope scores no bye of a league without a Swiss stage', async () => {
    h.publicReads.seasonStages.mockResolvedValue([{ id: 'rr-1', bracket_type: 'round_robin' }]);

    const league = await renderStandings({ scope: 'league', id: 'season-1' });

    expect(h.publicReads.seasonByeRounds).not.toHaveBeenCalled();
    expect(eve(league)).toMatchObject({ wins: 0, losses: 0 });
  });
});
