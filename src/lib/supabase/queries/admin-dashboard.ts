import { supabase } from '../client';
import { readAllRows, readRowsByIds } from './matches';

/** The competitions the admin dashboard counts and lists matches for. */
export interface ActiveCompetitions {
  /** Active leagues in scope (for a resource admin: the directly assigned ones). */
  seasonIds: string[];
  /** Active tournaments without a league. */
  standaloneTournamentIds: string[];
  /** Every active tournament in scope: standalone ones plus the phases of active leagues. */
  tournamentIds: string[];
}

type TournamentRow = { id: string; season_id: string | null };
type SeasonRow = { id: string; archived: boolean; is_test_season: boolean };

const isActiveSeason = (season: SeasonRow) => !season.archived && !season.is_test_season;

/**
 * The live part of an admin's scope: leagues that are neither archived nor
 * test leagues, and the non-archived tournaments that are standalone or a
 * phase of such a league. `null` scope = unrestricted (site admin).
 *
 * A phase whose league was not read counts as inactive, so a dangling or
 * unreadable league never lets its matches into the dashboard. Archiving a
 * league archives its phases, so `archived = false` on tournaments already
 * covers an archived league; the league check also covers test leagues.
 * Every read pages past the PostgREST row cap or chunks its id list.
 */
export async function listActiveCompetitions(scope: {
  seasonIds: string[] | null;
  tournamentIds: string[] | null;
}): Promise<ActiveCompetitions> {
  const tournamentRows =
    scope.tournamentIds === null
      ? await readAllRows<TournamentRow>((from, to) =>
          supabase
            .from('tournaments')
            .select('id, season_id')
            .eq('archived', false)
            .order('id')
            .range(from, to)
        )
      : await readRowsByIds<TournamentRow>(scope.tournamentIds, (chunk) =>
          supabase
            .from('tournaments')
            .select('id, season_id')
            .in('id', chunk)
            .eq('archived', false)
            .order('id')
        );

  const seasonRows =
    scope.seasonIds === null
      ? await readAllRows<SeasonRow>((from, to) =>
          supabase.from('seasons').select('id, archived, is_test_season').order('id').range(from, to)
        )
      : await readRowsByIds<SeasonRow>(
          [...scope.seasonIds, ...tournamentRows.flatMap((row) => (row.season_id ? [row.season_id] : []))],
          (chunk) => supabase.from('seasons').select('id, archived, is_test_season').in('id', chunk).order('id')
        );

  const activeSeasons = new Set(seasonRows.filter(isActiveSeason).map((season) => season.id));

  const eligible = tournamentRows.filter((row) => row.season_id === null || activeSeasons.has(row.season_id));
  const assignedSeasonIds = scope.seasonIds === null ? null : new Set(scope.seasonIds);

  return {
    seasonIds: [...activeSeasons].filter((id) => assignedSeasonIds === null || assignedSeasonIds.has(id)),
    standaloneTournamentIds: eligible.filter((row) => row.season_id === null).map((row) => row.id),
    tournamentIds: eligible.map((row) => row.id),
  };
}
