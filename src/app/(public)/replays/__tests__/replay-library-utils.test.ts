import { describe, expect, it } from 'vitest';
import type { ReplayLibraryRow } from '@/lib/supabase/queries/replay-library';
import {
  applyReplayLibraryParams,
  getReplayLibraryLeagueOptions,
  getReplayLibraryRoundOptions,
  getReplayLibraryTournamentOptions,
  isReplayLibraryBrowseView,
  parseReplayLibraryParams,
} from '../replay-library-utils';

const rows: ReplayLibraryRow[] = [
  {
    label: 'Zara vs Bea, Winter League, Finals, match 3',
    date: '2026-02-03T10:00:00Z',
    league: 'Winter League',
    tournamentName: 'Winter Playoffs',
    round: 'Finals',
    matchNumber: 3,
    player1Name: 'Zara',
    player1PsUsername: 'zaraps',
    player2Name: 'Bea',
    player2PsUsername: 'beaps',
    matchUrl: '/tournaments/t-2/matches/m-2',
    replayUrl: 'https://replay.example/2',
  },
  {
    label: 'Alice vs Bob, Summer League, Round 2, match 1',
    date: '2026-06-12T10:00:00Z',
    league: 'Summer League',
    tournamentName: 'Summer Open',
    round: 'Round 2',
    matchNumber: 1,
    player1Name: 'Alice',
    player1PsUsername: 'aliceps',
    player2Name: 'Bob',
    player2PsUsername: 'bobby',
    matchUrl: '/tournaments/t-1/matches/m-1',
    replayUrl: 'https://replay.example/1',
  },
  {
    label: 'Alice vs Chris, Summer League, Round 3, match 2',
    date: '2026-06-14T10:00:00Z',
    league: 'Summer League',
    tournamentName: 'Summer Open',
    round: 'Round 3',
    matchNumber: 2,
    player1Name: 'Alice',
    player1PsUsername: 'aliceps',
    player2Name: 'Chris',
    player2PsUsername: 'chris_alt',
    matchUrl: '/tournaments/t-1/matches/m-2',
    replayUrl: 'https://replay.example/3',
  },
];

describe('parseReplayLibraryParams', () => {
  it('parses bookmarkable filters and falls back to safe defaults', () => {
    expect(parseReplayLibraryParams({
      q: '  Alice ',
      league: ' Summer League ',
      tournament: ' Summer Open ',
      round: ' Round 2 ',
      start: '2026-06-01',
      end: 'invalid',
      sort: 'invalid',
    })).toEqual({
      query: 'Alice',
      league: 'Summer League',
      tournament: 'Summer Open',
      round: 'Round 2',
      startDate: '2026-06-01',
      endDate: '',
      sort: 'date-desc',
    });
  });

  it('folds legacy username param into query', () => {
    expect(parseReplayLibraryParams({
      q: 'alice',
      username: ' bobby ',
    })).toEqual({
      query: 'alice bobby',
      league: '',
      tournament: '',
      round: '',
      startDate: '',
      endDate: '',
      sort: 'date-desc',
    });
  });
});

describe('applyReplayLibraryParams', () => {
  it('filters rows when legacy username is folded into q tokens', () => {
    expect(
      applyReplayLibraryParams(rows, {
        query: 'alice bobby',
        league: 'Summer League',
        tournament: 'Summer Open',
        round: 'Round 2',
        startDate: '2026-06-12',
        endDate: '2026-06-12',
        sort: 'date-desc',
      }).map((row) => row.replayUrl),
    ).toEqual(['https://replay.example/1']);
  });

  it('filters rows by bookmarkable query params including PS usernames', () => {
    expect(
      applyReplayLibraryParams(rows, {
        query: 'bobby',
        league: 'Summer League',
        tournament: 'Summer Open',
        round: 'Round 2',
        startDate: '2026-06-12',
        endDate: '2026-06-12',
        sort: 'date-desc',
      }).map((row) => row.replayUrl),
    ).toEqual(['https://replay.example/1']);
  });

  it('sorts rows oldest first when requested', () => {
    expect(
      applyReplayLibraryParams(rows, {
        query: '',
        league: '',
        tournament: '',
        round: '',
        startDate: '',
        endDate: '',
        sort: 'date-asc',
      }).map((row) => row.replayUrl),
    ).toEqual([
      'https://replay.example/2',
      'https://replay.example/1',
      'https://replay.example/3',
    ]);
  });

  it('sorts rows by players alphabetically when requested', () => {
    expect(
      applyReplayLibraryParams(rows, {
        query: '',
        league: '',
        tournament: '',
        round: '',
        startDate: '',
        endDate: '',
        sort: 'players-asc',
      }).map((row) => row.label),
    ).toEqual([
      'Alice vs Bob, Summer League, Round 2, match 1',
      'Alice vs Chris, Summer League, Round 3, match 2',
      'Zara vs Bea, Winter League, Finals, match 3',
    ]);
  });

  it('sorts rows by round descending when requested', () => {
    expect(
      applyReplayLibraryParams(rows, {
        query: '',
        league: '',
        tournament: '',
        round: '',
        startDate: '',
        endDate: '',
        sort: 'round-desc',
      }).map((row) => row.round),
    ).toEqual(['Round 3', 'Round 2', 'Finals']);
  });
});

describe('getReplayLibraryLeagueOptions', () => {
  it('returns unique non-empty leagues sorted alphabetically', () => {
    expect(getReplayLibraryLeagueOptions(rows)).toEqual(['Summer League', 'Winter League']);
  });
});

describe('getReplayLibraryTournamentOptions', () => {
  it('returns unique non-empty tournaments sorted alphabetically', () => {
    expect(getReplayLibraryTournamentOptions(rows)).toEqual(['Summer Open', 'Winter Playoffs']);
  });
});

describe('getReplayLibraryRoundOptions', () => {
  it('returns unique non-empty rounds sorted alphabetically', () => {
    expect(getReplayLibraryRoundOptions(rows)).toEqual(['Finals', 'Round 2', 'Round 3']);
  });
});

describe('replay library sort cycle', () => {
  it('parseReplayLibraryParams preserves explicit sort params', () => {
    expect(parseReplayLibraryParams({ sort: 'players-asc' }).sort).toBe('players-asc');
  });
});

describe('isReplayLibraryBrowseView', () => {
  it('is true only with no filters and a date sort', () => {
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({}))).toBe(true);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ sort: 'date-asc', page: '4' }))).toBe(true);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ q: 'alice' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ username: 'bobby' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ league: 'Summer League' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ tournament: 'Summer Open' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ round: 'Finals' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ start: '2026-01-01' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ end: '2026-01-01' }))).toBe(false);
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ sort: 'league-asc' }))).toBe(false);
  });

  it('ignores malformed params the parser already drops', () => {
    expect(isReplayLibraryBrowseView(parseReplayLibraryParams({ start: 'yesterday', q: '   ' }))).toBe(true);
  });
});
