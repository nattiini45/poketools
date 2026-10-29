/**
 * The part of team legality that needs the learnsets: can the species learn each move, and can it have the ability.
 *
 * `validateTeam` (./validation.ts) is synchronous and reads no learnsets, because it also runs team by team inside the
 * ruleset pin-impact check (up to 2000 teams per request, twice each) where a learnset rule cancels out of the
 * comparison anyway. The checks here are asynchronous (learnsets are lazy-loaded) and belong to the server-side team
 * check (`src/lib/team-check`) that every validator surface shares: the teambuilder's live check, the import, the
 * Evolution Point Buy check and the AI agent's tool. They reuse the dex legality helpers (`validateSetLegality`), so a
 * team is judged by the same rules as the per-slot picker (`/api/pkmn/validate-set`).
 *
 * Universe: a standard ruleset restricts learnsets to its generation (what Showdown's `[Gen 9]` formats do); a National
 * Dex ruleset counts a move learned in any generation, and resolves Mega Evolutions and past species.
 *
 * What is NOT judged, on purpose: a species, move or ability the dex of the universe does not know is the plain
 * validator's `unknown_*` issue, not an illegal one; a ruleset allowlist may list an unreleased `Future` entry that no
 * dex universe resolves, and such a species has no learnset to judge by. Generations 1 and 2 have no abilities.
 */
import type { PokemonSet, SetIssue } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';
import {
  getAbility,
  getMove,
  getNationalAbility,
  getNationalMove,
  getNationalSpecies,
  getSpecies,
  validateSetLegality,
} from './dex';
import { codedIssue, readSet } from './validation';

/** Learnset and ability issues of a team (set issues only; empty when every readable set is legal). */
export async function checkTeamLegality(pokemon: readonly PokemonSet[], ruleset: Ruleset): Promise<SetIssue[]> {
  const gen = ruleset.gen;
  const universe = ruleset.rules.universe;
  const national = universe === 'national';
  const resolveSpecies = (name: string) => (national ? getNationalSpecies(name, gen) : getSpecies(name, gen));
  const resolveMove = (name: string) => (national ? getNationalMove(name, gen) : getMove(name, gen));
  const resolveAbility = (name: string) => (national ? getNationalAbility(name, gen) : getAbility(name, gen));

  const perSet = await Promise.all(
    pokemon.map(async (raw, index): Promise<SetIssue[]> => {
      const set = readSet(raw);
      if (set === null) return []; // reported as `malformed_set` by the plain validator
      const species = resolveSpecies(set.species);
      if (!species) return []; // unknown or unreleased species: nothing to judge by

      const issues: SetIssue[] = [];
      const moves = set.moves.filter((m) => m !== '' && resolveMove(m) !== undefined);
      const legality = await validateSetLegality(species.name, set.ability, moves, gen, universe);

      for (const { move, legal } of legality.moveIssues) {
        if (legal) continue;
        const shown = resolveMove(move)?.name ?? move;
        issues.push({
          pokemon_index: index,
          species: species.name,
          issue: `${species.name} cannot legally learn ${shown}`,
          severity: 'error',
          ...codedIssue('move_illegal', { species: species.name, move: shown }),
        });
      }

      // Only an ability the dex knows is judged here; an unknown one is `unknown_ability` already.
      const ability = set.ability === '' ? undefined : resolveAbility(set.ability);
      if (gen >= 3 && ability && legality.abilities.length > 0 && !legality.abilityLegal) {
        issues.push({
          pokemon_index: index,
          species: species.name,
          issue: `${species.name} cannot have the ability ${ability.name}`,
          severity: 'error',
          ...codedIssue('ability_illegal', { species: species.name, ability: ability.name }),
        });
      }
      return issues;
    }),
  );

  return perSet.flat();
}
