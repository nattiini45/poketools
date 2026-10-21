import { z } from 'zod';
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

/**
 * The species of a stored team (`match_prep_teams.pokemon`). Only `species` is read; a row
 * whose jsonb is not a list of sets with a species fails loudly (never read as "no team").
 */
const registeredTeamSchema = z.array(z.object({ species: z.string().min(1) }));

/** PostgREST `max_rows`: a page never returns more rows than this. */
const PREP_PAGE_SIZE = 1000;
/** Match ids per `.in()` filter (keeps the request URL short). */
const PREP_MATCH_CHUNK = 200;

function registeredSpeciesOf(row: { match_id: string; player_id: string; pokemon: Json }): string[] {
  const parsed = registeredTeamSchema.safeParse(row.pokemon);
  if (!parsed.success) {
    throw new Error(
      `match_prep_teams row for match ${row.match_id}, player ${row.player_id} has a malformed team: ${parsed.error.message}`
    );
  }
  return parsed.data.map((set) => set.species);
}

/**
 * The registered team species per match and player (`match id → player id → species[]`), for the
 * EPB participation rule (a line in the registered team counts as brought: brought = registered team). A match or
 * player without a registered team has no entry. Paged, so a season never truncates at
 * `max_rows`.
 */
export async function getRegisteredSpeciesByMatches(
  matchIds: readonly string[]
): Promise<Map<string, Map<string, string[]>>> {
  const out = new Map<string, Map<string, string[]>>();
  const unique = [...new Set(matchIds)];
  for (let i = 0; i < unique.length; i += PREP_MATCH_CHUNK) {
    const chunk = unique.slice(i, i + PREP_MATCH_CHUNK);
    for (let from = 0; ; from += PREP_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('match_prep_teams')
        .select('id, match_id, player_id, pokemon')
        .in('match_id', chunk)
        .order('id')
        .range(from, from + PREP_PAGE_SIZE - 1);
      if (error) throw error;
      for (const row of data) {
        const byPlayer = out.get(row.match_id) ?? new Map<string, string[]>();
        byPlayer.set(row.player_id, registeredSpeciesOf(row));
        out.set(row.match_id, byPlayer);
      }
      if (data.length < PREP_PAGE_SIZE) break;
    }
  }
  return out;
}

/** One match's registered team species per player (`player id → species[]`); see `getRegisteredSpeciesByMatches`. */
export async function getRegisteredSpeciesByMatch(matchId: string): Promise<Map<string, string[]>> {
  const byMatch = await getRegisteredSpeciesByMatches([matchId]);
  return byMatch.get(matchId) ?? new Map();
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
