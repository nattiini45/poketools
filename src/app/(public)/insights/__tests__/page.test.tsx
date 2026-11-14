import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Insights standings score a Swiss stage's stored byes in the league scope as they do in the tournament scope.

const h = vi.hoisted(() => ({
  publicReads: {
    seasonList: vi.fn(),
    tournamentList: vi.fn(),
    ratingLeaderboard: vi.fn(),
    streakLeaderboard: vi.fn(),
    hiddenPlayerIds: vi.fn(),
    aggregatesSummary: vi.fn(),
    totalGames: vi.fn(),
    season: vi.fn(),
    seasonStages: vi.fn(),
    seasonParticipants: vi.fn(),
    seasonBattleStats: vi.fn(),
    seasonEvolutionPoints: vi.fn(),
    seasonFormatRules: vi.fn(),
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
import ScopeSelector from '@/components/shared/ScopeSelector';

interface StandingsRowView {
  player_id: string;
  wins: number;
  losses: number;
}

/** Renders the page for a scope and returns its children (the scope selector and the client tabs). */
async function renderPage(searchParams: Record<string, string>): Promise<ReactElement[]> {
  const suspense = (await InsightsPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    children: ReactElement;
  }>;
  const content = suspense.props.children as ReactElement<Record<string, unknown>> & {
    type: (props: Record<string, unknown>) => Promise<ReactElement<{ children: ReactElement[] }>>;
  };
  const page = await content.type(content.props);
  return page.props.children;
}

/** Renders the page for a scope and returns the standings rows handed to the client tabs. */
async function renderStandings(searchParams: Record<string, string>): Promise<StandingsRowView[]> {
  const tabs = (await renderPage(searchParams)).find((child) => child?.type === InsightsTabs) as ReactElement<{
    standings: StandingsRowView[];
  }>;
  return tabs.props.standings;
}

/** The tournament options handed to the scope selector. */
async function renderTournamentOptions(searchParams: Record<string, string>): Promise<{ id: string; name: string }[]> {
  const selector = (await renderPage(searchParams)).find((child) => child?.type === ScopeSelector) as ReactElement<{
    tournaments: { id: string; name: string }[];
  }>;
  return selector.props.tournaments;
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
  reads.hiddenPlayerIds.mockResolvedValue([]);
  reads.aggregatesSummary.mockResolvedValue([]);
  reads.totalGames.mockResolvedValue(0);
  reads.seasonParticipants.mockResolvedValue(players);
  reads.seasonBattleStats.mockResolvedValue([]);
  reads.seasonEvolutionPoints.mockResolvedValue({});
  reads.seasonFormatRules.mockResolvedValue(null);
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

describe('Insights standings of an Evolution Point Buy league', () => {
  // a beat b; c has played nobody but holds the most evolution points.
  const epbPlayers = ['a', 'b', 'c'].map((id) => ({ id, name: id, avatar_url: null, gym_type: null }));
  const order = (rows: StandingsRowView[]) => rows.map((row) => row.player_id);

  beforeEach(() => {
    const reads = h.publicReads;
    reads.season.mockResolvedValue({ id: 'season-1', name: 'League', format_type: 'evolution_point_buy' });
    reads.seasonParticipants.mockResolvedValue(epbPlayers);
    reads.tournamentParticipants.mockResolvedValue(epbPlayers);
    reads.seasonEvolutionPoints.mockResolvedValue({ a: 0, b: 1, c: 10 });
    reads.tournament.mockResolvedValue({
      id: 'rr-1',
      name: 'Round robin',
      bracket_type: 'round_robin',
      is_doubles: false,
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    });
  });

  it('ranks the league scope by the stored tiebreaker order', async () => {
    h.publicReads.seasonFormatRules.mockResolvedValue({
      tiebreaker_order: ['evolution_points', 'match_points'],
    });

    expect(order(await renderStandings({ scope: 'league', id: 'season-1' }))).toEqual(['c', 'b', 'a']);
  });

  it('ranks the tournament scope of a stage by the stored tiebreaker order', async () => {
    h.publicReads.seasonFormatRules.mockResolvedValue({
      tiebreaker_order: ['evolution_points', 'match_points'],
    });

    expect(order(await renderStandings({ scope: 'tournament', id: 'rr-1' }))).toEqual(['c', 'b', 'a']);
  });

  it('ranks by the format pack chain without a rules row, and for an order the standings cannot use', async () => {
    h.publicReads.seasonFormatRules.mockResolvedValue(null);
    expect(order(await renderStandings({ scope: 'league', id: 'season-1' }))).toEqual(['a', 'c', 'b']);

    h.publicReads.seasonFormatRules.mockResolvedValue({ tiebreaker_order: ['decision_match'] });
    expect(order(await renderStandings({ scope: 'league', id: 'season-1' }))).toEqual(['a', 'c', 'b']);
  });

  it('reads the rules and evolution points of no other league format', async () => {
    h.publicReads.season.mockResolvedValue({ id: 'season-1', name: 'League', format_type: 'singles' });
    h.publicReads.tournament.mockResolvedValue({
      id: 'rr-1',
      name: 'Round robin',
      bracket_type: 'round_robin',
      is_doubles: false,
      season_id: 'season-1',
      season_format_type: 'singles',
    });

    await renderStandings({ scope: 'league', id: 'season-1' });
    await renderStandings({ scope: 'tournament', id: 'rr-1' });

    expect(h.publicReads.seasonFormatRules).not.toHaveBeenCalled();
    expect(h.publicReads.seasonEvolutionPoints).not.toHaveBeenCalled();
  });
});

describe('the tournament picker of a league stage', () => {
  const listed = [{ id: 'open-1', name: 'Open Cup' }];

  it('names a stage that the public tournament list does not hold, ahead of the listed ones', async () => {
    h.publicReads.tournamentList.mockResolvedValue(listed);
    expect(await renderTournamentOptions({ scope: 'tournament', id: 'swiss-1' })).toEqual([
      { id: 'swiss-1', name: 'Swiss' },
      { id: 'open-1', name: 'Open Cup' },
    ]);
  });

  it('adds nothing when the scope is a listed tournament or not a tournament', async () => {
    h.publicReads.tournamentList.mockResolvedValue([{ id: 'swiss-1', name: 'Swiss' }, ...listed]);
    expect(await renderTournamentOptions({ scope: 'tournament', id: 'swiss-1' })).toHaveLength(2);
    h.publicReads.tournamentList.mockResolvedValue(listed);
    expect(await renderTournamentOptions({ scope: 'league', id: 'season-1' })).toEqual(listed);
  });
});
