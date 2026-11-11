import { describe, expect, it } from 'vitest';
import type { PublicMatch } from '@/lib/match/public-match';
import { buildTournamentHero, parseTournamentTab, tournamentPageTabs } from '../page-view';

const match = (over: Partial<PublicMatch>): PublicMatch =>
  ({
    id: 'm',
    round_id: 'r',
    tournament_id: 't',
    player_1_id: 'a',
    player_2_id: 'b',
    player_1_name: 'Aria',
    player_2_name: 'Bram',
    player_1_avatar_url: null,
    player_2_avatar_url: 'b.webp',
    winner_id: null,
    status: 'scheduled',
    scheduled_at: null,
    games: [],
    ...over,
  }) as PublicMatch;

const STANDINGS = [
  { player_id: 'b', player_name: 'Bram', player_avatar_url: 'b.webp', points: 6 },
  { player_id: 'a', player_name: 'Aria', player_avatar_url: null, points: 3 },
];

describe('tournamentPageTabs', () => {
  it('opens a round robin on its table and gives it the result matrix', () => {
    expect(tournamentPageTabs('round_robin', { ruleset: true, reports: false })).toEqual(['standings', 'rounds', 'matrix', 'stats', 'ruleset']);
  });

  it('opens an elimination tournament on its bracket', () => {
    expect(tournamentPageTabs('double_elim', { ruleset: false, reports: true })).toEqual(['bracket', 'rounds', 'stats', 'report']);
    expect(tournamentPageTabs('swiss', { ruleset: false, reports: false })).toEqual(['standings', 'rounds', 'stats']);
  });
});

describe('parseTournamentTab', () => {
  const tabs = tournamentPageTabs('swiss', { ruleset: true, reports: false });

  it('takes a tab the tournament has', () => {
    expect(parseTournamentTab('rounds', tabs)).toBe('rounds');
  });

  it('falls back to the first tab for anything else', () => {
    for (const value of [undefined, '', 'bracket', 'matrix', ['rounds', 'stats']]) {
      expect(parseTournamentTab(value, tabs)).toBe('standings');
    }
  });
});

describe('buildTournamentHero', () => {
  it('shows a match in progress before the next kickoff', () => {
    const view = buildTournamentHero({
      matches: [
        match({ id: 'next', scheduled_at: '2026-10-20T18:00:00Z' }),
        match({ id: 'live', status: 'in_progress' }),
        match({ id: 'done', status: 'completed', winner_id: 'a' }),
      ],
      standings: STANDINGS,
    });
    expect(view.match).toMatchObject({ kind: 'live', matchId: 'live' });
    expect(view.match?.home).toMatchObject({ playerId: 'a', rank: 2, points: 3 });
    expect(view.match?.away).toMatchObject({ playerId: 'b', rank: 1, points: 6, avatarUrl: 'b.webp' });
    expect(view.matchesPlayed).toBe(1);
    expect(view.leader).toBeNull();
  });

  it('shows the earliest scheduled match that has a kickoff', () => {
    const view = buildTournamentHero({
      matches: [
        match({ id: 'open' }),
        match({ id: 'later', scheduled_at: '2026-10-27T18:00:00Z' }),
        match({ id: 'sooner', scheduled_at: '2026-10-20T18:00:00Z' }),
      ],
      standings: [],
    });
    expect(view.match).toMatchObject({ kind: 'next', matchId: 'sooner', scheduledAt: '2026-10-20T18:00:00Z' });
    expect(view.match?.home.rank).toBeNull();
  });

  it('shows the top of the table once a match has been played and none is open', () => {
    const played = buildTournamentHero({ matches: [match({ status: 'completed', winner_id: 'b' })], standings: STANDINGS });
    expect(played.match).toBeNull();
    expect(played.leader).toMatchObject({ playerId: 'b', rank: 1, points: 6 });
    expect(buildTournamentHero({ matches: [match({})], standings: STANDINGS }).leader).toBeNull();
    expect(buildTournamentHero({ matches: [match({ status: 'completed' })], standings: [] }).leader).toBeNull();
  });
});
