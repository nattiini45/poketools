import { supabase } from '../client';
import { readRowsByIds } from './matches';
import { COMMAND_INDEX_LIMIT, type CommandIndexEntry } from '@/lib/admin/command-index';

type IndexRow = { id: string; name: string; archived: boolean; created_at: string };

const COLUMNS = 'id, name, archived, created_at';

/** Newest first; the id breaks ties so the order is total and a refetch never reshuffles equal timestamps. */
const newestFirst = (a: IndexRow, b: IndexRow) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

/**
 * The competitions an admin may jump to from the command menu: leagues and standalone tournaments (a league's
 * phases are reached through the league), archived ones flagged, newest first, at most `COMMAND_INDEX_LIMIT`
 * entries (a limit under PostgREST's `max_rows`, so nothing is truncated silently). `null` scope = unrestricted
 * (site admin); a resource admin's lists hold only the ids given. Only id, name and the archived flag leave this
 * module.
 */
export async function listCommandIndex(scope: {
  seasonIds: string[] | null;
  tournamentIds: string[] | null;
}): Promise<CommandIndexEntry[]> {
  const [seasons, tournaments] = await Promise.all([
    scope.seasonIds === null
      ? supabase
          .from('seasons')
          .select(COLUMNS)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(COMMAND_INDEX_LIMIT)
          .then(({ data, error }) => {
            if (error) throw error;
            return (data ?? []) as IndexRow[];
          })
      : readRowsByIds<IndexRow>(scope.seasonIds, (chunk) =>
          supabase.from('seasons').select(COLUMNS).in('id', chunk).order('id')
        ),
    scope.tournamentIds === null
      ? supabase
          .from('tournaments')
          .select(COLUMNS)
          .is('season_id', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(COMMAND_INDEX_LIMIT)
          .then(({ data, error }) => {
            if (error) throw error;
            return (data ?? []) as IndexRow[];
          })
      : readRowsByIds<IndexRow>(scope.tournamentIds, (chunk) =>
          supabase.from('tournaments').select(COLUMNS).in('id', chunk).is('season_id', null).order('id')
        ),
  ]);

  const entries = [
    ...seasons.map((row) => ({ row, kind: 'league' as const })),
    ...tournaments.map((row) => ({ row, kind: 'tournament' as const })),
  ].sort((a, b) => newestFirst(a.row, b.row));

  return entries
    .slice(0, COMMAND_INDEX_LIMIT)
    .map(({ row, kind }) => ({ id: row.id, name: row.name, kind, archived: row.archived }));
}
