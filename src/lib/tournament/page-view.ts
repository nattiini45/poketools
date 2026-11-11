import type { HeroSide } from '@/components/competition/HeroBits';
import type { PublicMatch } from '@/lib/match/public-match';
import type { BracketType } from '@/types/tournament';
import type { Standing } from './types';

/**
 * The public tournament page's own view (plan §4.2, B3): which tab the `?tab=` link strip shows, and what the
 * hero says. Pure: both read only what the page already holds, so neither costs a query.
 */

export const TOURNAMENT_TAB_PARAM = 'tab';

export type TournamentPageTab = 'standings' | 'bracket' | 'rounds' | 'matrix' | 'stats' | 'ruleset' | 'report';

/** The tabs of a tournament page, in order: the table or bracket first, then the rounds. */
export function tournamentPageTabs(bracketType: BracketType, has: { ruleset: boolean; reports: boolean }): TournamentPageTab[] {
  const elimination = bracketType === 'single_elim' || bracketType === 'double_elim';
  return [
    elimination ? 'bracket' : 'standings',
    'rounds',
    ...(bracketType === 'round_robin' ? (['matrix'] as const) : []),
    'stats',
    ...(has.ruleset ? (['ruleset'] as const) : []),
    ...(has.reports ? (['report'] as const) : []),
  ];
}

/** The `?tab=` value; anything else shows the first tab. */
export function parseTournamentTab(value: string | string[] | undefined, tabs: readonly TournamentPageTab[]): TournamentPageTab {
  return tabs.find((tab) => tab === value) ?? tabs[0];
}

export interface TournamentHeroMatch {
  kind: 'live' | 'next';
  matchId: string;
  scheduledAt: string | null;
  home: HeroSide;
  away: HeroSide;
}

export interface TournamentHeroView {
  matchesPlayed: number;
  /** A match in progress, else the next kickoff. */
  match: TournamentHeroMatch | null;
  /** Without a match to show: the top of the table once a match has been played. */
  leader: HeroSide | null;
}

export function buildTournamentHero(input: {
  matches: readonly PublicMatch[];
  /** The ranked table; empty for an elimination bracket. */
  standings: readonly Pick<Standing, 'player_id' | 'player_name' | 'player_avatar_url' | 'points'>[];
}): TournamentHeroView {
  const { matches, standings } = input;
  const side = (playerId: string, name: string, avatarUrl: string | null): HeroSide => {
    const index = standings.findIndex((row) => row.player_id === playerId);
    return { playerId, name, avatarUrl, ace: null, rank: index >= 0 ? index + 1 : null, points: index >= 0 ? standings[index].points : null };
  };
  const toMatch = (m: PublicMatch, kind: TournamentHeroMatch['kind']): TournamentHeroMatch => ({
    kind,
    matchId: m.id,
    scheduledAt: m.scheduled_at,
    home: side(m.player_1_id, m.player_1_name, m.player_1_avatar_url),
    away: side(m.player_2_id, m.player_2_name, m.player_2_avatar_url),
  });

  const live = matches.find((m) => m.status === 'in_progress');
  const next = matches
    .filter((m) => m.status === 'scheduled' && m.scheduled_at)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))[0];
  const match = live ? toMatch(live, 'live') : next ? toMatch(next, 'next') : null;
  const matchesPlayed = matches.filter((m) => m.status === 'completed').length;
  const top = standings[0];

  return {
    matchesPlayed,
    match,
    leader: !match && top && matchesPlayed > 0 ? side(top.player_id, top.player_name, top.player_avatar_url) : null,
  };
}
