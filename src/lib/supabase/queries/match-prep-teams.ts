import { supabase } from '../client';
import type { Tables, Json } from '@/types/database';
import type { MatchPrepTeam } from '@/types/match-prep';
import type { PokemonSet, TeamImportSource } from '@/types/team';

type PrepRow = Tables<'match_prep_teams'>;

function toPrepTeam(row: PrepRow): MatchPrepTeam {
  return {
    id: row.id,
    match_id: row.match_id,
    player_id: row.player_id,
    pokemon: row.pokemon as unknown as PokemonSet[],
    import_source: row.import_source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Get a player's prep team for a specific match */
export async function getMatchPrepTeam(
  matchId: string,
  playerId: string
): Promise<MatchPrepTeam | null> {
  const { data, error } = await supabase
    .from('match_prep_teams')
    .select('*')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPrepTeam(data) : null;
}

/** Get both players' prep teams for a match (admin use) */
export async function getMatchPrepTeams(
  matchId: string
): Promise<MatchPrepTeam[]> {
  const { data, error } = await supabase
    .from('match_prep_teams')
    .select('*')
    .eq('match_id', matchId);

  if (error) throw error;
  return data.map(toPrepTeam);
}

/** Create or update a player's prep team for a match */
export async function upsertMatchPrepTeam(
  matchId: string,
  playerId: string,
  pokemon: PokemonSet[],
  importSource: TeamImportSource
): Promise<MatchPrepTeam> {
  const { data, error } = await supabase
    .from('match_prep_teams')
    .upsert(
      {
        match_id: matchId,
        player_id: playerId,
        pokemon: pokemon as unknown as Json,
        import_source: importSource,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'match_id,player_id' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return toPrepTeam(data);
}

/** List all prep teams for a player (for dashboard) */
export async function listMatchPrepTeamsByPlayer(
  playerId: string
): Promise<MatchPrepTeam[]> {
  const { data, error } = await supabase
    .from('match_prep_teams')
    .select('*')
    .eq('player_id', playerId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data.map(toPrepTeam);
}

/** Delete a prep team */
export async function deleteMatchPrepTeam(id: string): Promise<void> {
  const { error } = await supabase
    .from('match_prep_teams')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Delete all prep teams for a match (match-scoped). Used by the admin
 * match-reset cleanup so re-finalizing a match rebuilds prep teams from
 * fresh hooks instead of keeping the old snapshots. Returns the count
 * of rows deleted so the cleanup can surface it in its summary.
 */
export async function deleteMatchPrepTeamsByMatch(matchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('match_prep_teams')
    .delete({ count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}
