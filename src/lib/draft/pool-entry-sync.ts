import { UserFacingError } from '@/lib/api/user-facing-error';
import { toID } from '@/lib/pkmn/i18n/id';
import { bulkCreatePoolEntries, createPoolEntry, getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import type { DraftPoolEntryFormData } from '@/types/draft-pool';

/** The 409 the pool-entry writers raise when the Pokémon is already listed under any spelling. */
export function isDuplicatePoolEntry(err: unknown): boolean {
  return err instanceof UserFacingError && err.code === 'pool_entry_duplicate_name';
}

/**
 * Makes sure every entry is listed in the season's draft pool and returns the names that still are not.
 *
 * The batch insert is all-or-nothing, so one name that a concurrent writer listed first (the folded-name unique
 * index refuses it) would otherwise keep every other entry out as well. After such a refusal each missing entry is
 * written on its own: a duplicate then means somebody else listed it, which is the outcome wanted, and any other
 * error leaves just that entry unresolved. The final read decides, so an entry that is not listed at the end is
 * reported whatever the writes answered.
 */
export async function syncPoolEntries(
  seasonId: string,
  entries: readonly DraftPoolEntryFormData[],
): Promise<string[]> {
  if (entries.length === 0) return [];
  try {
    await bulkCreatePoolEntries([...entries]);
    return [];
  } catch (err) {
    if (!isDuplicatePoolEntry(err)) throw err;
  }

  const listedNow = new Set((await getPoolEntries(seasonId)).map((e) => toID(e.pokemon_name)));
  for (const entry of entries) {
    if (listedNow.has(toID(entry.pokemon_name))) continue;
    try {
      await createPoolEntry(entry);
    } catch (err) {
      if (!isDuplicatePoolEntry(err)) {
        console.error(`[pool-entry-sync] could not add the pool entry ${entry.pokemon_name}:`, err);
      }
    }
  }

  const listedAtEnd = new Set((await getPoolEntries(seasonId)).map((e) => toID(e.pokemon_name)));
  return entries.filter((entry) => !listedAtEnd.has(toID(entry.pokemon_name))).map((entry) => entry.pokemon_name);
}
