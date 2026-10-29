/**
 * Test fixtures for a team's `PokemonSet` (`src/types/team.ts`).
 *
 * Every team boundary (`teamPokemonSchema`) refuses a set that lacks `evs`, `ivs` or `moves`, so a route test that posts
 * a team posts full sets. `makeSet` builds one that passes the schema and the plain validator; pass overrides for the
 * member a test is about.
 */
import type { PokemonSet } from '@/types/team';

export function makeSet(species: string = 'Garchomp', overrides: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: 'Leftovers',
    ability: 'Rough Skin',
    evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Jolly',
    level: 100,
    moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Stealth Rock'],
    ...overrides,
  };
}
