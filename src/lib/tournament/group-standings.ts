import type { MatchRecord, Standing } from './types';

/**
 * League group tables (league groups design, lead rulings round 3). Pure and client-safe.
 *
 * A group table counts ALL of its members' matches, cross-group matches included (the history's group tables:
 * 16 games per trainer in a 7-group season, 2 x 6 in-group + 4 cross). The format's standings functions only
 * count matches between two of the trainers they rank, so a group table is never computed over the group alone:
 * the caller computes ONE table over every trainer of the league (format tiebreakers, one season context) and
 * these helpers split it. Every tiebreak of that chain compares two trainers (match points, evolution points,
 * kill difference, head-to-head, Buchholz), so the members keep the order the full table gives them: tiebreaks
 * are unchanged.
 *
 * The combined table holds every trainer. When the trainers have played different numbers of matches (unequal
 * groups, or a week half played) it ranks by points per match; otherwise by points, exactly as the full table
 * does. Among equal points per match the full table's order (points, then its tiebreaks) decides.
 */

/** A league group as the tables see it: id, display name and its trainers. */
export interface StandingsGroup {
  id: string;
  name: string;
  playerIds: readonly string[];
}

/** One group's table: the group and its members' rows in table order. */
export interface GroupTable<T extends Standing = Standing> {
  group: StandingsGroup;
  standings: T[];
}

/** How the combined table of a grouped league is ranked. */
export type CombinedRanking = 'points' | 'points_per_match';

/** Matches a row has played (wins, losses and draws). */
export function matchesPlayed(row: Pick<Standing, 'wins' | 'losses' | 'draws'>): number {
  return row.wins + row.losses + row.draws;
}

/** Points per match played; 0 before the first match. */
export function pointsPerMatch(row: Pick<Standing, 'points' | 'wins' | 'losses' | 'draws'>): number {
  const played = matchesPlayed(row);
  return played === 0 ? 0 : row.points / played;
}

/**
 * Each group's rows, in the order of `table` (a full league table), one entry per group in group order. A group
 * member without a row in `table` is not invented; a row of a trainer in no group appears in no group table.
 */
export function splitGroupTables<T extends Standing>(
  table: readonly T[],
  groups: readonly StandingsGroup[],
): GroupTable<T>[] {
  return groups.map((group) => {
    const members = new Set(group.playerIds);
    return { group, standings: table.filter((row) => members.has(row.player_id)) };
  });
}

/** `points_per_match` when the rows have played different numbers of matches, else `points`. */
export function combinedRanking(table: readonly Pick<Standing, 'wins' | 'losses' | 'draws'>[]): CombinedRanking {
  const counts = new Set(table.map(matchesPlayed));
  return counts.size > 1 ? 'points_per_match' : 'points';
}

/**
 * The combined table of a grouped league from its full table: unchanged when every trainer has played as many
 * matches as the others, else re-ranked by points per match with the full table's order breaking ties (a
 * stable sort). Returns the ranking it applied.
 */
export function rankCombinedTable<T extends Standing>(
  table: readonly T[],
): { ranking: CombinedRanking; standings: T[] } {
  const ranking = combinedRanking(table);
  if (ranking === 'points') return { ranking, standings: [...table] };
  const position = new Map(table.map((row, index) => [row.player_id, index]));
  const standings = [...table].sort(
    (a, b) => pointsPerMatch(b) - pointsPerMatch(a) || position.get(a.player_id)! - position.get(b.player_id)!,
  );
  return { ranking, standings };
}

/** Input of `groupTablesUpToWeek`: the league's groups, its trainers and the phase's completed matches. */
export interface GroupTablesUpToWeekInput {
  groups: readonly StandingsGroup[];
  /** Completed match records of the phase, `round_number` = week. */
  matches: readonly MatchRecord[];
  /** Count weeks 1..lastWeek (the Hinrunde: `plan.firstHalfLastWeek`; a placement week: the week before it). */
  lastWeek: number;
  /**
   * The format's standings over every given trainer and match (one season context for every table, e.g.
   * `(ids, records) => computeStandingsFromContext(context, ids, names, records)`).
   */
  computeTable: (playerIds: string[], matches: MatchRecord[]) => Standing[];
}

/**
 * Every group's table over weeks 1..`lastWeek`, cross-group matches included, keyed by group id. Used for the
 * placement weeks (the tables after the previous week) and the per-group redraft order (the first-half tables,
 * worst first). Pure: the format's standings come in through `computeTable`.
 */
export function groupTablesUpToWeek(input: GroupTablesUpToWeekInput): Map<string, Standing[]> {
  const playerIds = input.groups.flatMap((group) => [...group.playerIds]);
  const matches = input.matches.filter((match) => match.round_number >= 1 && match.round_number <= input.lastWeek);
  const table = input.computeTable(playerIds, matches);
  return new Map(splitGroupTables(table, input.groups).map(({ group, standings }) => [group.id, standings]));
}
