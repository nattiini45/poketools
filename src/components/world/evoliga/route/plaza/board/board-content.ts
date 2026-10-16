import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { MatchStatus } from '@/types/match';
import type { Locale } from '@/i18n/config';
import type { EvoligaRouteData } from '../../route-data';
import { kickoffTickerState } from '@/lib/route-world/board-text';
import { paintCaps, paintT } from '@/lib/route-world/paint-copy';

/**
 * What the two plaza boards broadcast, derived once from the page-loaded
 * league data. Pure over its input so a capture five minutes apart shows the
 * same pages; names, rounds and dates are never hardcoded.
 */
export interface BoardContent {
  league: string;
  stage: string;
  round: number;
  participants: number;
  completed: number;
  /** Top of the table, surname-caps, for the PULS masthead page. */
  top: BoardTableRow[];
  /** Full season table (capped at the board's row budget). */
  table: BoardTableRow[];
  live: { home: string; away: string } | null;
  /** The current matchday's fixtures — every status, kickoff order. */
  upcoming: BoardFixture[];
  /** The next matchday's fixtures, below the current ones on the SPIELPLAN. */
  later: BoardFixture[];
  /**
   * Fixture counts BEFORE the board caps (fidelity W1 r4): a board that paints
   * fewer rows than the matchday holds says so (`+N WEITERE`). Optional so
   * hand-built test content stays valid; absent means the arrays are whole.
   */
  upcomingTotal?: number;
  laterTotal?: number;
  /** Most recent completed matches, newest first. */
  results: BoardResult[];
  /** Scores of the most recently finished matchday only. */
  lastMatchday: BoardResult[];
  /** That matchday's stage and number, e.g. `Rückrunde · Spieltag 1`. */
  lastMatchdayLabel: string | null;
  next: BoardKickoff | null;
  /**
   * Every distinct still-`scheduled` kickoff, earliest first (`next` is its
   * head). Optional so hand-built test content stays valid; the live ticker
   * walks it to find the first kickoff still in the FUTURE at paint time
   * (fidelity W1 r2 — never "JETZT" next to a past timestamp).
   */
  kickoffs?: readonly BoardKickoff[];
  /**
   * The viewer's locale the content was shaped for (i18n D11): the date
   * shape, the matchday label and every word the board painters letter.
   */
  locale: Locale;
}

/** One kickoff slot as the boards print it. */
export interface BoardKickoff {
  date: string;
  time: string;
  iso: string;
}

export interface BoardTableRow {
  name: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  diff: number;
  /**
   * Places gained (+) or lost (−) since the previous matchday, for the `↑↓`
   * glyph. Derived server-side against the table as it stood before the latest
   * matchday with results (the standings query attaches `rank_change` to each
   * row; the preview fixtures mirror it). `null` on the first matchday — the
   * board leaves the column closed rather than guessing a direction.
   */
  rankChange: number | null;
}

/**
 * The status pill on a SPIELPLAN row, as a neutral key (i18n-core §7 step 5):
 * labelled only at paint time (`paint.board.status.*`).
 */
export type BoardFixtureStatusKey = 'upcoming' | 'live' | 'done';

/** A board fixture's status — always a neutral key (the sweep dropped the German logic words). */
export type BoardFixtureStatus = BoardFixtureStatusKey;

export interface BoardFixture {
  home: string;
  away: string;
  date: string;
  time: string;
  status: BoardFixtureStatus;
  /** Matchday number inside its stage, for the SPIELPLAN group label. */
  matchday: number;
}

export interface BoardResult {
  home: string;
  away: string;
  score: string;
  date: string;
  /** 'home' | 'away' | null — who took the match, for the accent bar. */
  winner: 'home' | 'away' | null;
}

export const BOARD_TABLE_ROWS = 8;
/** Current-matchday rows on the SPIELPLAN page. */
export const BOARD_FIXTURE_ROWS = 4;
/** Next-matchday rows below them. */
export const BOARD_NEXT_ROWS = 2;
export const BOARD_RESULT_ROWS = 4;

const FIXTURE_STATUS: Record<MatchStatus, BoardFixtureStatusKey> = {
  scheduled: 'upcoming',
  in_progress: 'live',
  pending_confirmation: 'done',
  completed: 'done',
  disputed: 'done',
};

/**
 * A match status as the SPIELPLAN board keys it (`disputed` and
 * `pending_confirmation` collapse to `done`). The docked fixture list reads
 * the same key so panel and board letter the same word.
 */
export function boardFixtureStatus(status: MatchStatus): BoardFixtureStatusKey {
  return FIXTURE_STATUS[status];
}

/** Broadcast style: surname only, caps. */
export function shortName(full: string): string {
  return full.split(' ').slice(-1)[0].toUpperCase();
}

/** `2026-09-17T…` → `17.9.` — string slicing keeps this timezone-stable. */
export function deDate(iso: string): string {
  const [month, day] = iso.slice(5, 10).split('-');
  return `${Number(day)}.${Number(month)}.`;
}

/**
 * Locale-aware board date. `'de'` delegates to `deDate` verbatim (`17.9.`),
 * `'en'` flips to `M/D`. String slicing keeps both zone-stable: the boards
 * paint the league's own calendar day, as the schedule stores it.
 */
export function boardDate(iso: string, locale: Locale): string {
  if (locale === 'en') {
    const [month, day] = iso.slice(5, 10).split('-');
    return `${Number(month)}/${Number(day)}`;
  }
  return deDate(iso);
}

/**
 * Matchday word per locale (`paint.common.matchday`, sentence case) — the
 * one label the board pages derive themselves, shared by this module's labels
 * and the painters' mastheads so the word can never disagree between the two.
 */
export function matchdayWord(locale: Locale): string {
  return paintT(locale)('common.matchday');
}

/** `2026-09-17T18:00:…` → `18:00`. */
export function deTime(iso: string): string {
  return iso.slice(11, 16);
}

/** A fixture with a known tip-off time — the preview source always sets one. */
function hasKickoff(
  fixture: LeagueFixture,
): fixture is LeagueFixture & { match: { scheduled_at: string } } {
  return fixture.match.scheduled_at !== null;
}

/** When a fixture belongs on the timeline: its kickoff, else when it was played. */
function fixtureAt(fixture: LeagueFixture): string {
  return fixture.match.scheduled_at ?? fixture.match.date_played ?? fixture.match.updated_at;
}

interface BoardMatchday {
  number: number;
  stageName: string;
  fixtures: LeagueFixture[];
}

/**
 * Fixtures grouped into matchdays. The league rows carry `round_id` but no
 * round number, so the groups are ordered by first kickoff and numbered inside
 * their own stage — the same order the season is played in.
 */
function buildMatchdays(fixtures: LeagueFixture[]): BoardMatchday[] {
  const byRound = new Map<string, LeagueFixture[]>();
  for (const fixture of fixtures) {
    const group = byRound.get(fixture.match.round_id);
    if (group) group.push(fixture);
    else byRound.set(fixture.match.round_id, [fixture]);
  }

  const numberPerStage = new Map<string, number>();
  return [...byRound.values()]
    .map((group) => [...group].sort((a, b) => fixtureAt(a).localeCompare(fixtureAt(b))))
    .sort((a, b) => fixtureAt(a[0]).localeCompare(fixtureAt(b[0])))
    .map((group) => {
      const { stageId, stageName } = group[0];
      const number = (numberPerStage.get(stageId) ?? 0) + 1;
      numberPerStage.set(stageId, number);
      return { number, stageName, fixtures: group };
    });
}

function toFixture(fixture: LeagueFixture, matchday: number, locale: Locale): BoardFixture {
  const { match } = fixture;
  return {
    home: shortName(match.player_1_name),
    away: shortName(match.player_2_name),
    date: match.scheduled_at ? boardDate(match.scheduled_at, locale) : '—',
    time: match.scheduled_at ? deTime(match.scheduled_at) : '—',
    status: FIXTURE_STATUS[match.status],
    matchday,
  };
}

function toResult(fixture: LeagueFixture, locale: Locale): BoardResult {
  const { match } = fixture;
  const home = match.games.filter((game) => game.winner_id === match.player_1_id).length;
  const away = match.games.filter((game) => game.winner_id === match.player_2_id).length;
  const winner =
    match.winner_id === match.player_1_id ? 'home' : match.winner_id === match.player_2_id ? 'away' : null;
  const when = match.date_played ?? match.scheduled_at ?? match.updated_at;
  return {
    home: shortName(match.player_1_name),
    away: shortName(match.player_2_name),
    score: `${home}:${away}`,
    date: when ? boardDate(when, locale) : '',
    winner,
  };
}

/** Two digits, for the countdown clock. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The two count fields of the season line: `12 SPIELE GESPIELT · 8 TEILNEHMER`. */
export function seasonLine(content: Pick<BoardContent, 'completed' | 'participants' | 'locale'>): string {
  const { locale } = content;
  return `${paintCaps(locale, 'board.gamesPlayed', { count: content.completed })} · ${paintCaps(locale, 'board.participants', {
    count: content.participants,
  })}`;
}

/**
 * Static footer line the page textures bake. `nextKickoffTicker()` overlays the
 * running countdown on top of it, so a board whose strip never uploads still
 * says when the next match starts.
 */
export function kickoffStamp(content: BoardContent): string {
  const { next, locale } = content;
  if (!next) return seasonLine(content);
  return `${paintCaps(locale, 'board.kickoffNext', { date: next.date, time: next.time })} · ${paintCaps(locale, 'board.participants', {
    count: content.participants,
  })}`;
}

/** `NÄCHSTER ANPFIFF IN 3 T 04:05:06 · 24.9. 18:00 UHR` — the countdown for one kickoff. */
function countdownTo(kickoff: BoardKickoff, remainingMs: number, locale: Locale): string {
  const seconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(seconds / 86_400);
  const clock = `${pad(Math.floor((seconds % 86_400) / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(
    seconds % 60,
  )}`;
  const span = days > 0 ? paintCaps(locale, 'board.countdownDays', { count: days, clock }) : clock;
  return paintCaps(locale, 'board.countdown', { clock: span, date: kickoff.date, time: kickoff.time });
}

/**
 * The live ticker, in the content's locale. `nowMs` is passed in so this
 * stays pure.
 *
 * Fidelity W1 r2: the old fallback painted `NÄCHSTER ANPFIFF JETZT · 17.9.
 * 18:00 UHR` once `next` had passed — beside a SPIELPLAN row that already
 * said LÄUFT for that match, with the real next kickoff days away. The
 * ordering (future `next` → live → first future kickoff → season line) now
 * lives in `kickoffTickerState` (board-text.ts, W1 r3) so the isles follow
 * the same rule.
 */
export function nextKickoffTicker(content: BoardContent, nowMs: number): string {
  const { locale } = content;
  const state = kickoffTickerState(content, nowMs);
  if (state?.kind === 'live') return paintCaps(locale, 'board.liveTicker', { home: state.home, away: state.away });
  if (state?.kind === 'next') return countdownTo(state.kickoff, Date.parse(state.iso) - nowMs, locale);
  return seasonLine(content);
}

/**
 * Derive the broadcast content from the page-loaded league data, shaped for
 * the viewer's `locale` (the plaza passes `useLocale()`; i18n D11). The
 * `'de'` default is the historical EvoLiga surface, kept for one-argument
 * test callers. Fixture statuses are neutral keys (`upcoming` / `live` /
 * `done`), labelled only when a painter letters the pill.
 */
export function buildBoardContent(data: EvoligaRouteData, locale: Locale): BoardContent {
  const active = data.stages.find((stage) => stage.status === 'active');
  const liveFixture = data.fixtures.find((fixture) => fixture.match.status === 'in_progress') ?? null;
  const completedFixtures = data.fixtures
    .filter((fixture) => fixture.match.status === 'completed')
    .sort((a, b) =>
      (b.match.date_played ?? b.match.scheduled_at ?? '').localeCompare(
        a.match.date_played ?? a.match.scheduled_at ?? '',
      ),
    );

  // The matchday in play: the one holding the live match, else the first with
  // an unplayed fixture, else the season's last.
  const matchdays = buildMatchdays(data.fixtures);
  const liveIndex = matchdays.findIndex((day) =>
    day.fixtures.some((fixture) => fixture.match.status === 'in_progress'),
  );
  const openIndex = matchdays.findIndex((day) =>
    day.fixtures.some((fixture) => fixture.match.status === 'scheduled'),
  );
  const currentIndex = liveIndex !== -1 ? liveIndex : openIndex !== -1 ? openIndex : matchdays.length - 1;
  const current = matchdays[currentIndex] ?? null;
  const upNext = matchdays[currentIndex + 1] ?? null;
  const finished =
    [...matchdays].reverse().find((day) => day.fixtures.every((f) => f.match.status === 'completed')) ?? null;

  const table = data.standings.slice(0, BOARD_TABLE_ROWS).map((row) => ({
    name: shortName(row.player_name),
    points: row.points,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    diff: row.kill_differential,
    // First-class contract field (`LeagueStanding.rank_change`); the `?? null`
    // only guards a payload that lost the key in transport.
    rankChange: row.rank_change ?? null,
  }));

  const kickoffs: BoardKickoff[] = [];
  for (const fixture of data.fixtures
    .filter(hasKickoff)
    .filter((f) => f.match.status === 'scheduled')
    .sort((a, b) => a.match.scheduled_at.localeCompare(b.match.scheduled_at))) {
    const iso = fixture.match.scheduled_at;
    if (kickoffs[kickoffs.length - 1]?.iso === iso) continue;
    kickoffs.push({ date: boardDate(iso, locale), time: deTime(iso), iso });
  }

  return {
    league: data.league.name.replace(/ \(Vorschau\)$/, ''),
    stage: active?.name ?? 'EvoLiga',
    round: active?.current_round ?? 1,
    participants: data.participants.length,
    completed: completedFixtures.length,
    top: table.slice(0, 4),
    table,
    live: liveFixture
      ? { home: shortName(liveFixture.match.player_1_name), away: shortName(liveFixture.match.player_2_name) }
      : null,
    upcoming: current
      ? current.fixtures.slice(0, BOARD_FIXTURE_ROWS).map((fixture) => toFixture(fixture, current.number, locale))
      : [],
    later: upNext
      ? upNext.fixtures.slice(0, BOARD_NEXT_ROWS).map((fixture) => toFixture(fixture, upNext.number, locale))
      : [],
    upcomingTotal: current ? current.fixtures.length : 0,
    laterTotal: upNext ? upNext.fixtures.length : 0,
    results: completedFixtures.slice(0, BOARD_RESULT_ROWS).map((fixture) => toResult(fixture, locale)),
    lastMatchday: finished
      ? finished.fixtures.slice(0, BOARD_RESULT_ROWS).map((fixture) => toResult(fixture, locale))
      : [],
    lastMatchdayLabel: finished
      ? `${finished.stageName} · ${paintT(locale)('common.matchdayN', { n: String(finished.number) })}`
      : null,
    next: kickoffs[0] ?? null,
    kickoffs,
    locale,
  };
}
