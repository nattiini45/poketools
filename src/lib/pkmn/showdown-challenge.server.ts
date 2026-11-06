import 'server-only';
/**
 * The dex side of the Showdown challenge (`./showdown-challenge.ts`): for a Pokémon id, whether it is a cosmetic forme of a
 * base species and which other formes a base species has. `getRawEntity` is the reader for a caller whose own list names
 * the entry (a Mega, a Primal or a `Future` forme that neither universe reader returns).
 */
import { getRawEntity } from './dex';
import { toID } from './i18n/id';
import type { ChallengeSpeciesInfo, ChallengeSpeciesLookup } from './showdown-challenge';

/** A lookup for generation `gen`'s dex; memoised per id, since a roster of a hundred species asks twice. */
export function challengeSpeciesLookup(gen: number): ChallengeSpeciesLookup {
  const cache = new Map<string, ChallengeSpeciesInfo | null>();
  return (id) => {
    if (cache.has(id)) return cache.get(id) ?? null;
    const species = getRawEntity('species', id, gen);
    let info: ChallengeSpeciesInfo | null = null;
    if (species !== undefined) {
      const isBase = species.baseSpecies === species.name;
      const base = isBase ? species : getRawEntity('species', species.baseSpecies, gen);
      const cosmetic = !isBase && base?.cosmeticFormes?.includes(species.name) === true;
      info = {
        cosmeticOf: cosmetic ? toID(species.baseSpecies) : null,
        formes: isBase ? (species.otherFormes ?? []).map(toID) : [],
      };
    }
    cache.set(id, info);
    return info;
  };
}
