/**
 * The dashboard's "Now" queue beyond matches: drafts where the player is on the clock, open business in a custom
 * league, and upcoming matches without a registered team. Pure and client-safe: the page reads the rows
 * (`queries/dashboard-now.ts`) and these builders shape what the queue shows.
 */
import { countOwedActions } from '@/lib/format-engine/runtime/owed-actions';
import { leagueDraftHref } from '@/lib/season/format-utils';
import type { ActiveDraftTurnRow, DashboardPhaseMatch, DashboardTournamentMatch, PlayerFormatFacts, PlayerPhaseTeamSlot, PlayerTeamSlotRow } from '@/lib/supabase/queries/dashboard-now';
import type { Json } from '@/types/database';

export type DashboardMatch = DashboardTournamentMatch | DashboardPhaseMatch;

export function mergeDashboardMatches(
  standalone: readonly DashboardTournamentMatch[],
  phases: readonly DashboardPhaseMatch[],
): DashboardMatch[] {
  return [...standalone, ...phases].sort((a, b) => {
    if (a.date_played === null && b.date_played !== null) return 1;
    if (a.date_played !== null && b.date_played === null) return -1;
    return (a.date_played && b.date_played ? Date.parse(b.date_played) - Date.parse(a.date_played) : 0)
      || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id);
  }).slice(0, 500);
}

export interface NowDraftTurn {
  poolId: string;
  leagueName: string;
  href: string;
  deadlineAt: string | null;
  paused: boolean;
  redraft: boolean;
}

export interface NowFormatAction {
  leagueId: string;
  leagueName: string;
  /** Actions with an open window the player has not submitted. */
  openActions: number;
  /** Open challenges addressed to the player. */
  challenges: number;
  /** The earliest accept deadline among those challenges. */
  answerBy: string | null;
}

export function buildDraftTurns(rows: readonly ActiveDraftTurnRow[]): NowDraftTurn[] {
  return rows.map((row) => {
    const redraft = row.pool_kind === 'redraft';
    return {
      poolId: row.pool_id,
      leagueName: row.season_name,
      href: redraft
        ? `/leagues/${row.season_id}/redraft`
        : (leagueDraftHref(row.season_id, row.season_format_type) ?? `/leagues/${row.season_id}`),
      deadlineAt: row.deadline_at,
      paused: row.paused,
      redraft,
    };
  });
}

/** One entry per league with something open, in the order of `leagues`. A league that is not on the kit engine has none. */
export function buildFormatActions(leagues: readonly { id: string; name: string }[], facts: PlayerFormatFacts): NowFormatAction[] {
  const out: NowFormatAction[] = [];
  for (const league of leagues) {
    const format = facts.formats.find((row) => row.season_id === league.id);
    if (format === undefined) continue;
    const flags: Record<string, Json> = {};
    for (const row of facts.flags) if (row.season_id === league.id) flags[row.key] = row.value;
    const openActions = countOwedActions({
      def: format.spec,
      flags,
      submissions: facts.submissions.filter((row) => row.season_id === league.id),
      linkedRelations: new Set(facts.links.filter((row) => row.season_id === league.id).map((row) => row.relation_key)),
    });
    const expiries = facts.challenges.filter((row) => row.season_id === league.id).map((row) => row.expires_at).sort();
    if (openActions === 0 && expiries.length === 0) continue;
    out.push({ leagueId: league.id, leagueName: league.name, openActions, challenges: expiries.length, answerBy: expiries[0] ?? null });
  }
  return out;
}

/**
 * The upcoming matches the player has no registered team for. A team counts for a match when it is linked to it or is
 * the player's planned team of the match's tournament (the rule of `getPlayerTeamForMatch`).
 */
export function teamlessMatchIds(
  matches: readonly { id: string; tournament_id: string; status: string }[],
  slots: readonly PlayerTeamSlotRow[],
): string[] {
  return matches
    .filter((match) => match.status === 'scheduled' || match.status === 'in_progress')
    .filter((match) => !slots.some((slot) => slot.tournament_id === match.tournament_id && (slot.match_id === match.id || slot.match_id === null)))
    .map((match) => match.id);
}

export function teamlessPhaseMatchIds(
  matches: readonly Pick<DashboardPhaseMatch, 'id' | 'phase_id' | 'status'>[],
  slots: readonly PlayerPhaseTeamSlot[],
): string[] {
  return matches
    .filter((match) => match.status === 'scheduled' || match.status === 'in_progress')
    .filter((match) => !slots.some((slot) => slot.phase_id === match.phase_id && (slot.match_id === match.id || slot.match_id === null)))
    .map((match) => match.id);
}
