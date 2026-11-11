import type { HeroSide } from '@/components/competition/HeroBits';
import type { LeagueFixture, LeagueStanding } from '@/lib/supabase/queries/league-standings';
import type { MatchStatus } from '@/types/match';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';

/**
 * The league hero's view of a league (plan §4.2, B2): matchday, a few counts and the one match the versus
 * panel shows. Pure: it reads only the world payload the league page already holds, so the hero costs no query.
 */

export type { HeroSide };

/** `yours`: the viewer's own open match. `live`: a match in progress. `next`: the next kickoff. */
export type HeroMatchKind = 'yours' | 'live' | 'next';

export interface HeroMatch {
  kind: HeroMatchKind;
  matchId: string;
  tournamentId: string;
  status: MatchStatus;
  scheduledAt: string | null;
  /** The viewer in a `yours` match, player 1 otherwise. */
  home: HeroSide;
  away: HeroSide;
  /** `yours` only: the viewer can report this match now (its round has started). */
  canSubmit: boolean;
}

export interface LeagueHeroView {
  /** The current stage's round; null before the first round. */
  matchday: number | null;
  matchesPlayed: number;
  /** Whole days until the end date of a running league; null otherwise and once the date has passed. */
  daysLeft: number | null;
  /** Whole days until the start date of an upcoming league; null otherwise and once the date has come. */
  startsInDays: number | null;
  match: HeroMatch | null;
  /** Without a match to show: the top of the table once a match has been played. */
  leader: HeroSide | null;
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `today` to `day` (`YYYY-MM-DD`), never negative. */
function daysUntil(day: string, now: number): number | null {
  const target = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return Math.max(0, Math.round((target - today) / DAY_MS));
}

const OPEN: readonly MatchStatus[] = ['in_progress', 'scheduled', 'pending_confirmation'];

function byKickoff(a: LeagueFixture, b: LeagueFixture): number {
  // Matches with a kickoff first, earliest first.
  return (a.match.scheduled_at ?? '9999').localeCompare(b.match.scheduled_at ?? '9999');
}

export function buildLeagueHero(input: {
  league: Pick<SeasonWithDetails, 'status' | 'start_date' | 'end_date'>;
  stages: readonly Pick<TournamentWithDetails, 'status' | 'current_round'>[];
  standings: readonly LeagueStanding[];
  fixtures: readonly LeagueFixture[];
  teamAces: Readonly<Record<string, string>>;
  /** The signed-in viewer's player id (display only: it picks which match the hero shows). */
  viewerId: string | null;
  /** Defaults to the render's clock. */
  now?: number;
}): LeagueHeroView {
  const { league, stages, standings, fixtures, teamAces, viewerId, now = Date.now() } = input;
  // The stage the league page names: active, else the next to play, else the last.
  const stage =
    stages.find((s) => s.status === 'active') ?? stages.find((s) => s.status !== 'completed') ?? stages[stages.length - 1] ?? null;

  const side = (playerId: string, name: string, avatarUrl: string | null): HeroSide => {
    const index = standings.findIndex((row) => row.player_id === playerId);
    return {
      playerId,
      name,
      avatarUrl,
      ace: teamAces[playerId] ?? null,
      rank: index >= 0 ? index + 1 : null,
      points: index >= 0 ? standings[index].points : null,
    };
  };
  const toMatch = (fixture: LeagueFixture, kind: HeroMatchKind): HeroMatch => {
    const m = fixture.match;
    const one = side(m.player_1_id, m.player_1_name, m.player_1_avatar_url);
    const two = side(m.player_2_id, m.player_2_name, m.player_2_avatar_url);
    const viewerIsTwo = kind === 'yours' && m.player_2_id === viewerId;
    return {
      kind,
      matchId: m.id,
      tournamentId: m.tournament_id,
      status: m.status,
      scheduledAt: m.scheduled_at,
      home: viewerIsTwo ? two : one,
      away: viewerIsTwo ? one : two,
      canSubmit: kind === 'yours' && m.round_status !== 'pending' && (m.status === 'scheduled' || m.status === 'in_progress'),
    };
  };

  const mine = viewerId
    ? fixtures
        .filter((f) => OPEN.includes(f.match.status) && (f.match.player_1_id === viewerId || f.match.player_2_id === viewerId))
        .sort(
          (a, b) =>
            // A started round before a pending one, then by status (in progress, scheduled, awaiting confirmation), then kickoff.
            Number(a.match.round_status === 'pending') - Number(b.match.round_status === 'pending') ||
            OPEN.indexOf(a.match.status) - OPEN.indexOf(b.match.status) ||
            byKickoff(a, b),
        )[0]
    : undefined;
  const live = fixtures.find((f) => f.match.status === 'in_progress');
  const next = fixtures.filter((f) => f.match.status === 'scheduled' && f.match.scheduled_at).sort(byKickoff)[0];
  const match = mine ? toMatch(mine, 'yours') : live ? toMatch(live, 'live') : next ? toMatch(next, 'next') : null;

  const matchesPlayed = fixtures.filter((f) => f.match.status === 'completed').length;
  const top = standings[0];

  return {
    matchday: stage && stage.current_round > 0 ? stage.current_round : null,
    matchesPlayed,
    daysLeft: league.status === 'active' && league.end_date ? daysUntil(league.end_date, now) || null : null,
    startsInDays: league.status === 'upcoming' && league.start_date ? daysUntil(league.start_date, now) || null : null,
    match,
    leader: !match && top && matchesPlayed > 0 ? side(top.player_id, top.player_name, top.player_avatar_url) : null,
  };
}
