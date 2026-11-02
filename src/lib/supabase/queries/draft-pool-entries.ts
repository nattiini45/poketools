import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { foldedPoolEntryDuplicate } from '@/lib/draft/pool-entry-names';
import type { Tables, TablesInsert } from '@/types/database';
import type { DraftPoolEntry, DraftPoolEntryFormData } from '@/types/draft-pool';

type EntryRow = Tables<'draft_pool_entries'>;

function toEntry(row: EntryRow): DraftPoolEntry {
  return {
    id: row.id,
    season_id: row.season_id,
    pokemon_name: row.pokemon_name,
    power_tier: row.power_tier,
    point_cost: row.point_cost,
    created_at: row.created_at,
  };
}

/**
 * Rows per request when reading a season's pool list. PostgREST caps every response at `max_rows` (1000), and a
 * National Dex pool with forms has more entries than that, so one unbounded read would silently drop the rest.
 */
export const POOL_ENTRIES_READ_CHUNK = 1000;

/**
 * Get all pool entries for a season, in `.range()` pages: the first page carries `count: 'exact'` and paging goes on
 * until that many rows arrived (one request for a list of up to 1000 entries). `id` breaks ties, so a static list
 * pages exactly. Under concurrent edits the pages are not a snapshot: an entry inserted mid-read shifts later offsets
 * forward (the repeat is dropped below), and one deleted behind the offset shifts them back, so a list edited while
 * it is read can miss a live entry until the next read.
 */
export async function getPoolEntries(seasonId: string): Promise<DraftPoolEntry[]> {
  const rows: EntryRow[] = [];
  let total: number | null = null;
  while (total === null || rows.length < total) {
    const from: number = rows.length;
    const page: { data: EntryRow[] | null; error: unknown; count: number | null } = await supabase
      .from('draft_pool_entries')
      .select('*', total === null ? { count: 'exact' } : undefined)
      .eq('season_id', seasonId)
      .order('power_tier')
      .order('pokemon_name')
      .order('id')
      .range(from, from + POOL_ENTRIES_READ_CHUNK - 1);

    if (page.error) throw page.error;
    const chunk = page.data ?? [];
    if (total === null) total = page.count ?? chunk.length;
    if (chunk.length === 0) break; // entries were deleted while paging
    rows.push(...chunk);
  }
  // An entry inserted mid-read shifts later offsets by one; drop the repeat (it would count a price twice).
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map(toEntry);
}

/** Get a single pool entry by season + pokemon name. */
export async function getPoolEntry(
  seasonId: string,
  pokemonName: string
): Promise<DraftPoolEntry | null> {
  const { data, error } = await supabase
    .from('draft_pool_entries')
    .select('*')
    .eq('season_id', seasonId)
    .eq('pokemon_name', pokemonName)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/**
 * A pool list names each Pokémon once by id (`uq_draft_pool_entries_season_folded_name`, next to the exact-name key):
 * the picks route folds names the same way, so a second spelling would count toward the pool's size without ever
 * being pickable. The unique index is the arbiter, so two writers racing with different spellings cannot both win.
 * A 23505 becomes 409 `pool_entry_duplicate_name`, naming the incoming entry that clashes (with a listed one or an
 * earlier one of the same batch); any other error passes through.
 */
async function poolEntryConflict(err: unknown, seasonId: string, names: readonly string[]): Promise<unknown> {
  if ((err as { code?: unknown } | null)?.code !== '23505') return err;
  console.error('[draft-pool-entries] duplicate pool entry:', err);
  const duplicate = foldedPoolEntryDuplicate(await getPoolEntries(seasonId), names) ?? names[0];
  return new UserFacingError(
    `${duplicate} is already in the draft pool (names are compared without case, spaces or punctuation)`,
    { code: 'pool_entry_duplicate_name', params: { pokemon: duplicate }, status: 409 },
  );
}

/** Add a single Pokemon to the draft pool. */
export async function createPoolEntry(
  input: DraftPoolEntryFormData
): Promise<DraftPoolEntry> {
  const insert: TablesInsert<'draft_pool_entries'> = {
    season_id: input.season_id,
    pokemon_name: input.pokemon_name,
    power_tier: input.power_tier ?? null,
    point_cost: input.point_cost ?? null,
  };

  const { data, error } = await supabase
    .from('draft_pool_entries')
    .insert(insert)
    .select()
    .single();

  if (error) throw await poolEntryConflict(error, input.season_id, [input.pokemon_name]);
  return toEntry(data);
}

/** Bulk add Pokemon to the draft pool. */
export async function bulkCreatePoolEntries(
  entries: DraftPoolEntryFormData[]
): Promise<DraftPoolEntry[]> {
  if (entries.length === 0) return [];

  const inserts: TablesInsert<'draft_pool_entries'>[] = entries.map((e) => ({
    season_id: e.season_id,
    pokemon_name: e.pokemon_name,
    power_tier: e.power_tier ?? null,
    point_cost: e.point_cost ?? null,
  }));

  const { data, error } = await supabase
    .from('draft_pool_entries')
    .insert(inserts)
    .select();

  if (error) {
    // The route checks that the entries share one season.
    throw await poolEntryConflict(error, entries[0].season_id, entries.map((e) => e.pokemon_name));
  }
  return data.map(toEntry);
}

/** Update a pool entry's tier or cost. */
export async function updatePoolEntry(
  id: string,
  updates: Partial<Pick<DraftPoolEntryFormData, 'power_tier' | 'point_cost'>>
): Promise<DraftPoolEntry> {
  const { data, error } = await supabase
    .from('draft_pool_entries')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toEntry(data);
}

/** Remove a single entry from the pool. */
export async function deletePoolEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from('draft_pool_entries')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/** Clear the entire pool for a season (for reimport). */
export async function deleteAllPoolEntries(seasonId: string): Promise<void> {
  const { error } = await supabase
    .from('draft_pool_entries')
    .delete()
    .eq('season_id', seasonId);

  if (error) throw error;
}
