/**
 * The competition list (redesign A4): the view model behind `CompetitionList` and the links between its five URLs.
 * Pure and client-safe. The pages translate and map their rows on the server (`toLeagueRow`, `toTournamentRow`);
 * the list only displays them and filters them by the search text, so a row carries display text and counts, never a
 * database row.
 */
import type { SeasonStatus, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import { leagueCreatedHref } from '@/lib/league-admin/tabs';

export type CompetitionKind = 'league' | 'tournament';
export type CompetitionView = 'active' | 'archived' | 'trash';

/** Where a competition stands, which decides the next step offered on its row. */
export type CompetitionNextAction = 'setup' | 'manage' | 'review' | 'open';

export interface CompetitionRow {
  id: string;
  name: string;
  /** The workspace page of the competition (the name links here). */
  href: string;
  /** The page the next-step link opens: the workspace, or the tab that finishes a custom league's set-up. */
  actionHref: string;
  action: CompetitionNextAction;
  /** Translated league format or bracket type. */
  formatLabel: string;
  /** The ruleset name, shown under the format. */
  rulesetName: string | null;
  /** Translated detail line under the name (stage count; best-of and doubles). */
  detail: string;
  status: SeasonStatus;
  statusLabel: string;
  archived: boolean;
  test: boolean;
  players: number;
  /** League dates as `YYYY-MM-DD` (Postgres `date`); null when unset. Tournaments have none. */
  startDate: string | null;
  endDate: string | null;
  /** When the competition was created (ISO instant); the dates of a tournament. */
  createdAt: string;
}

const HREFS: Record<CompetitionKind, Partial<Record<CompetitionView, string>>> = {
  league: { active: '/admin/leagues', archived: '/admin/leagues/archived', trash: '/admin/leagues/trash' },
  tournament: { active: '/admin/tournaments', archived: '/admin/tournaments/archived' },
};

/** The URL of one kind and view. Only leagues have a trash: a tournament asked for its trash lands on its active list. */
export function competitionHref(kind: CompetitionKind, view: CompetitionView): string {
  return HREFS[kind][view] ?? HREFS[kind].active!;
}

function nextAction(status: SeasonStatus, archived: boolean): CompetitionNextAction {
  if (archived) return 'open';
  if (status === 'upcoming') return 'setup';
  if (status === 'completed') return 'review';
  return 'manage';
}

export interface CompetitionRowText {
  formatLabel: string;
  statusLabel: string;
  detail: string;
}

export function toLeagueRow(league: SeasonWithDetails, text: CompetitionRowText): CompetitionRow {
  const href = `/admin/leagues/${league.id}`;
  const action = nextAction(league.status, league.archived);
  return {
    id: league.id,
    name: league.name,
    href,
    actionHref: action === 'setup' ? leagueCreatedHref(league.id, league.format_type) : href,
    action,
    formatLabel: text.formatLabel,
    rulesetName: league.ruleset_name,
    detail: text.detail,
    status: league.status,
    statusLabel: text.statusLabel,
    archived: league.archived,
    test: league.is_test_season,
    players: league.participant_count,
    startDate: league.start_date,
    endDate: league.end_date,
    createdAt: league.created_at,
  };
}

export function toTournamentRow(tournament: TournamentWithDetails, text: CompetitionRowText): CompetitionRow {
  const href = `/admin/tournaments/${tournament.id}/rounds`;
  return {
    id: tournament.id,
    name: tournament.name,
    href,
    actionHref: href,
    action: nextAction(tournament.status, tournament.archived),
    formatLabel: text.formatLabel,
    rulesetName: tournament.ruleset_name || null,
    detail: text.detail,
    status: tournament.status,
    statusLabel: text.statusLabel,
    archived: tournament.archived,
    test: false,
    players: tournament.participant_count,
    startDate: null,
    endDate: null,
    createdAt: tournament.created_at,
  };
}

/** Lower case without accents, so `poke` finds `Poké`. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Whether every word of the search text appears in the haystack (names, formats and the like), in any order. */
export function matchesQuery(haystack: readonly (string | null | undefined)[], query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = fold(haystack.filter(Boolean).join(' '));
  return terms.every((term) => text.includes(term));
}

export function rowMatchesQuery(row: CompetitionRow, query: string): boolean {
  return matchesQuery([row.name, row.formatLabel, row.rulesetName, row.statusLabel, row.detail], query);
}
