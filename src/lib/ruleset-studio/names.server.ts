import 'server-only';
/**
 * English display names of dex ids, for the name-based views of a ruleset (`Ruleset.bans`, `Ruleset.additions`,
 * `Ruleset.allow`) and for the places that print a ruleset in English (the AI context, the rules text of the public
 * page before it localizes).
 *
 * The lookup goes through the base `Dex` (every generation's entities, past ones included: a ban of a Mega Evolution
 * or of a move the current generation dropped still names its entity). An id the dex does not know keeps the id as its
 * name, so a stored typo stays visible instead of disappearing. Names are memoised per process; the dex is immutable per
 * deploy.
 *
 * The display of a name in the viewer's language is not done here: the UI localizes the English name through
 * `src/lib/pkmn/i18n` (`localize*`).
 */
import { Dex } from '@pkmn/dex';
import { clauseName } from '@/lib/pkmn/clauses';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';

const names: Record<RulesetCategory, Map<string, string>> = {
  pokemon: new Map(),
  moves: new Map(),
  items: new Map(),
  abilities: new Map(),
};

function lookup(category: RulesetCategory, id: string): string {
  switch (category) {
    case 'pokemon': {
      const entity = Dex.species.get(id);
      return entity.exists ? entity.name : id;
    }
    case 'moves': {
      const entity = Dex.moves.get(id);
      return entity.exists ? entity.name : id;
    }
    case 'items': {
      const entity = Dex.items.get(id);
      return entity.exists ? entity.name : id;
    }
    case 'abilities': {
      const entity = Dex.abilities.get(id);
      return entity.exists ? entity.name : id;
    }
  }
}

/** The English display name of an id; the id itself when the dex does not know it. */
export function entryName(category: RulesetCategory, id: string): string {
  const cache = names[category];
  let name = cache.get(id);
  if (name === undefined) {
    name = lookup(category, id);
    cache.set(id, name);
  }
  return name;
}

/** The English display names of ids, in the given order. */
export function entryNames(category: RulesetCategory, ids: readonly string[]): string[] {
  return ids.map((id) => entryName(category, id));
}

/** The Showdown name of a clause id (`speciesclause` to `Species Clause`); an unknown id comes back unchanged. */
export function clauseNames(ids: readonly string[]): string[] {
  return ids.map(clauseName);
}
