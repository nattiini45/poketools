import { describe, expect, it } from 'vitest';
import {
  competitionHref,
  matchesQuery,
  rowMatchesQuery,
  toLeagueRow,
  toTournamentRow,
  type CompetitionRow,
} from '../competition-list';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';

const TEXT = { formatLabel: 'Singles', statusLabel: 'Active', detail: '1 stage' };

function row(over: Partial<CompetitionRow> = {}): CompetitionRow {
  return {
    id: 's1',
    name: 'Sakura Cup',
    href: '/admin/leagues/s1',
    actionHref: '/admin/leagues/s1',
    action: 'manage',
    formatLabel: 'Evolution Point Buy',
    rulesetName: 'Gen 9 OU',
    detail: '2 stages',
    status: 'active',
    statusLabel: 'Active',
    archived: false,
    test: false,
    players: 8,
    startDate: null,
    endDate: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

describe('competitionHref: the five URLs and the trash', () => {
  it('maps each kind and view to its existing URL', () => {
    expect(competitionHref('league', 'active')).toBe('/admin/leagues');
    expect(competitionHref('league', 'archived')).toBe('/admin/leagues/archived');
    expect(competitionHref('league', 'trash')).toBe('/admin/leagues/trash');
    expect(competitionHref('tournament', 'active')).toBe('/admin/tournaments');
    expect(competitionHref('tournament', 'archived')).toBe('/admin/tournaments/archived');
  });

  it('a tournament has no trash: it falls back to its active list', () => {
    expect(competitionHref('tournament', 'trash')).toBe('/admin/tournaments');
  });
});

describe('matchesQuery', () => {
  it('is true for an empty or blank search', () => {
    expect(matchesQuery(['Anything'], '')).toBe(true);
    expect(matchesQuery(['Anything'], '   ')).toBe(true);
  });

  it('needs every word, in any order, ignoring case', () => {
    expect(matchesQuery(['Sakura Cup', 'Singles'], 'cup SAKURA')).toBe(true);
    expect(matchesQuery(['Sakura Cup', 'Singles'], 'sakura doubles')).toBe(false);
  });

  it('ignores accents on both sides and skips empty haystack parts', () => {
    expect(matchesQuery(['Poké Cup', null, undefined], 'poke')).toBe(true);
    expect(matchesQuery(['Poke Cup'], 'poké')).toBe(true);
  });
});

describe('rowMatchesQuery: name, format, ruleset, status and detail', () => {
  it.each([
    ['name', 'sakura'],
    ['format', 'point buy'],
    ['ruleset', 'gen 9'],
    ['status', 'active'],
    ['detail', '2 stages'],
  ])('finds a row by its %s', (_part, query) => {
    expect(rowMatchesQuery(row(), query)).toBe(true);
  });

  it('does not find a row by text it does not show', () => {
    expect(rowMatchesQuery(row(), 'doubles')).toBe(false);
  });
});

function season(over: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id: 's1',
    name: 'Open League',
    description: '',
    format_type: 'singles',
    ruleset_id: null,
    start_date: '2026-10-01',
    end_date: '2026-10-31',
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: true,
    core_pool: null,
    point_buy_list_id: null,
    language: 'en',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ruleset_name: 'Gen 9 OU',
    participant_count: 8,
    tournament_count: 1,
    ...over,
  };
}

describe('toLeagueRow: the next step follows where the league stands', () => {
  it.each([
    ['upcoming', false, 'setup'],
    ['active', false, 'manage'],
    ['completed', false, 'review'],
    ['upcoming', true, 'open'],
    ['active', true, 'open'],
  ] as const)('%s, archived %s: %s', (status, archived, action) => {
    expect(toLeagueRow(season({ status, archived }), TEXT).action).toBe(action);
  });

  it('copies counts, dates and flags and carries the translated text it was given', () => {
    expect(toLeagueRow(season(), TEXT)).toEqual({
      id: 's1',
      name: 'Open League',
      href: '/admin/leagues/s1',
      actionHref: '/admin/leagues/s1',
      action: 'manage',
      formatLabel: 'Singles',
      rulesetName: 'Gen 9 OU',
      detail: '1 stage',
      status: 'active',
      statusLabel: 'Active',
      archived: false,
      test: true,
      players: 8,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      createdAt: '2026-09-01T00:00:00Z',
    });
  });

  it('an upcoming custom league goes to its Format tab, where attaching a format is the first step', () => {
    const custom = toLeagueRow(season({ status: 'upcoming', format_type: 'custom' }), TEXT);
    expect(custom.actionHref).toBe('/admin/leagues/s1?tab=format');
    expect(custom.href).toBe('/admin/leagues/s1');
    expect(toLeagueRow(season({ status: 'active', format_type: 'custom' }), TEXT).actionHref).toBe('/admin/leagues/s1');
  });
});

describe('toTournamentRow', () => {
  const tournament = {
    id: 't1',
    name: 'Open Cup',
    status: 'completed',
    archived: false,
    ruleset_name: '',
    participant_count: 4,
    created_at: '2026-10-03T08:00:00Z',
  } as TournamentWithDetails;

  it('links the rounds page, has no dates of its own and no ruleset when none is pinned', () => {
    expect(toTournamentRow(tournament, TEXT)).toMatchObject({
      href: '/admin/tournaments/t1/rounds',
      actionHref: '/admin/tournaments/t1/rounds',
      action: 'review',
      rulesetName: null,
      startDate: null,
      endDate: null,
      test: false,
      players: 4,
      createdAt: '2026-10-03T08:00:00Z',
    });
  });
});
