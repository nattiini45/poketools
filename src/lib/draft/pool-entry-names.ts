import { toID } from '@/lib/pkmn/i18n/id';

/**
 * The first name of `incoming` that names the same Pokémon as a name of `existing` or as an earlier name of
 * `incoming`, compared by id (`Mr. Mime`, `mr mime` and `MRMIME` are one). The picks route folds names the same
 * way, so two such entries are one pickable Pokémon: the pool would count both and could never fill its rounds.
 * `null` when every incoming name is new.
 */
export function foldedPoolEntryDuplicate(
  existing: readonly { pokemon_name: string }[],
  incoming: readonly string[],
): string | null {
  const seen = new Set(existing.map((e) => toID(e.pokemon_name)));
  for (const name of incoming) {
    const id = toID(name);
    if (seen.has(id)) return name;
    seen.add(id);
  }
  return null;
}
