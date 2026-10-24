/**
 * Pure helpers of the admin match list view (`AdminMatchList` and its row and filter
 * siblings): the score of a row, its replay count and auto-confirm countdown, and the
 * choices the filter bar derives from the filter options. No React, no fetch.
 */
import { computeMatchGamesWon } from '@/lib/match/aggregation';
import { STANDALONE_LEAGUE, activeMatchListFilters, type MatchListUrlState } from '@/lib/admin/match-list';
import type { PlayerSearchScope } from '@/lib/players/player-search';
import type { GameSummary } from '@/types/match';
import type {
  AdminMatchFilterOptions,
  AdminMatchRow,
  AdminMatchRulesetOption,
} from '@/lib/supabase/queries/matches';

const HOUR_MS = 3_600_000;

/** Games won by each seat, or `null` for a match without recorded games. */
export function matchScore(
  row: Pick<AdminMatchRow, 'games' | 'player_1_id' | 'player_2_id'>,
): { p1: number; p2: number } | null {
  if (row.games.length === 0) return null;
  return computeMatchGamesWon(row.games, row.player_1_id, row.player_2_id);
}

/** Games that carry a replay link (manual games have an empty `replay_url`). */
export function replayCount(games: readonly GameSummary[]): number {
  return games.filter((game) => game.replay_url.trim() !== '').length;
}

export type AutoConfirmCountdown = { kind: 'hours'; hours: number } | { kind: 'underHour' } | { kind: 'due' };

/**
 * Time until a pending match confirms itself: whole hours (rounded up), under an hour, or
 * due (the moment has passed and the confirmation job has not run yet). `null` for any other
 * status and for a pending match without an auto-confirm moment.
 */
export function autoConfirmCountdown(
  row: Pick<AdminMatchRow, 'status' | 'auto_confirm_at'>,
  nowMs: number,
): AutoConfirmCountdown | null {
  if (row.status !== 'pending_confirmation' || !row.auto_confirm_at) return null;
  const dueMs = Date.parse(row.auto_confirm_at);
  if (Number.isNaN(dueMs)) return null;
  const remaining = dueMs - nowMs;
  if (remaining <= 0) return { kind: 'due' };
  if (remaining < HOUR_MS) return { kind: 'underHour' };
  return { kind: 'hours', hours: Math.ceil(remaining / HOUR_MS) };
}

/**
 * Which empty-state text an empty page gets: a filter other than the search box is blamed
 * first, then the search, else there is simply nothing.
 */
export function matchListEmptyKey(url: MatchListUrlState): 'noFilterResults' | 'noSearchResults' | 'none' {
  if (activeMatchListFilters(url).some((key) => key !== 'q')) return 'noFilterResults';
  return url.q ? 'noSearchResults' : 'none';
}

/**
 * The tournament or league the player picker is anchored to. `GET /api/admin/player-search` searches the
 * whole directory but needs a scope the caller administers (it is only a guard), so the picker borrows one
 * from the admin's own filter options: the selected phase, else the first phase of the selected league, else
 * the first phase of any league, else the first standalone tournament, else a league without phases. A
 * tournament id also passes for the admin of its league. `null` = nothing in scope to search from.
 */
export function matchPlayerSearchScope(
  options: AdminMatchFilterOptions | null,
  url: Pick<MatchListUrlState, 'league' | 'phase'>,
): PlayerSearchScope | null {
  if (!options) return null;
  if (url.phase) {
    const known =
      options.tournaments.some((tournament) => tournament.id === url.phase) ||
      options.leagues.some((league) => league.phases.some((phase) => phase.id === url.phase));
    if (known) return { tournamentId: url.phase };
  }
  const selected = options.leagues.find((league) => league.id === url.league);
  const selectedPhase = selected?.phases[0];
  if (selectedPhase) return { tournamentId: selectedPhase.id };
  for (const league of options.leagues) {
    if (league.phases[0]) return { tournamentId: league.phases[0].id };
  }
  if (options.tournaments[0]) return { tournamentId: options.tournaments[0].id };
  // Every league is phase-less here.
  const phaseLess = selected ?? options.leagues[0];
  return phaseLess ? { seasonId: phaseLess.id } : null;
}

/**
 * The rulesets the Ruleset select offers: those of the selected phase, of the selected
 * league's phases, or of the standalone tournaments; every ruleset in scope when no league
 * is selected.
 */
export function rulesetChoices(
  options: AdminMatchFilterOptions | null,
  url: Pick<MatchListUrlState, 'league' | 'phase'>,
): AdminMatchRulesetOption[] {
  if (!options) return [];
  const phases =
    url.league === STANDALONE_LEAGUE
      ? options.tournaments
      : (options.leagues.find((league) => league.id === url.league)?.phases ?? null);
  if (phases === null) return options.rulesets;
  const scoped = url.phase ? phases.filter((phase) => phase.id === url.phase) : phases;
  const ids = new Set(scoped.map((phase) => phase.ruleset_id));
  return options.rulesets.filter((ruleset) => ids.has(ruleset.id));
}
