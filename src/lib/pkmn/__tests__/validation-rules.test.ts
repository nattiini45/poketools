import { describe, expect, it } from 'vitest';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { PokemonSet, StatSpread } from '@/types/team';
import { validateTeam } from '../validation';

// Real dex, no mocks: what the validator enforces from the frozen resolved rules of a ruleset.

const EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function mon(overrides: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: '',
    species: 'Garchomp',
    gender: '',
    item: 'Leftovers',
    ability: 'Rough Skin',
    evs: EVS,
    ivs: IVS,
    nature: 'Jolly',
    level: 100,
    moves: ['Earthquake'],
    ...overrides,
  };
}

const codes = (result: ReturnType<typeof validateTeam>) => result.issues.map((i) => i.code);

describe('validateTeam from the resolved rules', () => {
  it('bans by dex id: the id of a name with accents, symbols and punctuation matches the entity', () => {
    const ruleset = makeRuleset({
      base_format: 'gen9ou',
      bans: { pokemon: ['Flabébé', 'Nidoran♀', "Farfetch'd"], moves: [], items: ["King's Rock"], abilities: [] },
      clauses: [],
    });
    expect(ruleset.rules.pokemon.ids).toEqual(['farfetchd', 'flabebe', 'nidoranf']);
    expect(codes(validateTeam([mon({ species: 'Flabébé', item: '', ability: '' })], ruleset))).toContain('species_banned');
    expect(ruleset.rules.items.ids).toEqual(['kingsrock']);
    expect(codes(validateTeam([mon({ item: "King's Rock" })], ruleset))).toContain('item_banned');
    // Nidoran♀ is banned by id (nidoranf); Nidoran♂ (nidoranm) is a different entity.
    expect(codes(validateTeam([mon({ species: 'Nidoran-M', item: '', ability: '' })], ruleset))).not.toContain('species_banned');
  });

  it('a Pokémon allowlist makes every unlisted Pokémon illegal and the listed ones legal', () => {
    const ruleset = makeRuleset({ allow: { pokemon: ['Garchomp', 'Pikachu'], moves: null, items: null, abilities: null } });
    expect(ruleset.rules.pokemon).toEqual({ mode: 'allow', ids: ['garchomp', 'pikachu'] });
    const result = validateTeam([mon(), mon({ species: 'Pikachu', ability: 'Static', item: 'Light Ball' }), mon({ species: 'Charizard', ability: 'Blaze', item: 'Charcoal' })], ruleset);
    expect(result.issues.filter((i) => i.code === 'species_not_allowed').map((i) => i.species)).toEqual(['Charizard']);
    expect(result.issues.find((i) => i.code === 'species_not_allowed')?.issue).toBe("Charizard is not on this ruleset's list of allowed Pokémon");
    expect(codes(result)).not.toContain('species_banned');
  });

  it('an allowlist entry the dex files under Future (a roster Mega Stone) is legal; one it does not list is not', () => {
    const ruleset = makeRuleset({
      universe: 'national',
      allow: { pokemon: null, moves: null, items: ['Feraligite', 'Leftovers'], abilities: null },
      clauses: [],
    });
    const result = validateTeam([mon({ item: 'Feraligite' })], ruleset);
    expect(codes(result)).not.toContain('unknown_item');
    expect(codes(result)).not.toContain('item_not_allowed');
    // A Future item that the allowlist leaves out is reported as not allowed, not skipped as unknown.
    expect(codes(validateTeam([mon({ item: 'Garchompite' })], ruleset))).toContain('item_not_allowed');
    // A block list does not widen the universe: the same item stays unknown there.
    expect(codes(validateTeam([mon({ item: 'Feraligite' })], makeRuleset({ universe: 'national', clauses: [] })))).toContain('unknown_item');
  });

  it('allowlists work for moves, items and abilities too, and a clean set passes', () => {
    const ruleset = makeRuleset({
      allow: { pokemon: null, moves: ['Earthquake'], items: ['Leftovers'], abilities: ['Rough Skin'] },
      clauses: [],
    });
    expect(validateTeam([mon()], ruleset).valid).toBe(true);
    const result = validateTeam([mon({ moves: ['Earthquake', 'Dragon Claw'], item: 'Choice Band', ability: 'Sand Veil' })], ruleset);
    expect(codes(result).sort()).toEqual(['ability_not_allowed', 'item_not_allowed', 'move_not_allowed']);
  });

  it('reads the generation from the ruleset, not from its name', () => {
    // Garchomp does not exist in generation 3.
    expect(codes(validateTeam([mon()], makeRuleset({ base_format: 'gen3ou', gen: 3 })))).toContain('unknown_species');
    expect(codes(validateTeam([mon()], makeRuleset({ base_format: 'gen9ou', gen: 9 })))).not.toContain('unknown_species');
  });

  it('the National Dex universe makes a Mega Evolution legal; the standard universe does not know it', () => {
    const mega = mon({ species: 'Charizard-Mega-X', item: 'Charizardite X', ability: 'Tough Claws', moves: ['Flare Blitz'] });
    expect(codes(validateTeam([mega], makeRuleset({ universe: 'standard', clauses: [] })))).toContain('unknown_species');
    expect(codes(validateTeam([mega], makeRuleset({ universe: 'national', clauses: [] })))).not.toContain('unknown_species');
  });

  it('enforces only the Species Clause and the Item Clause, by clause id', () => {
    const ruleset = makeRuleset({ clauses: ['Species Clause', 'Item Clause', 'Sleep Clause Mod', 'OHKO Clause'] });
    const result = validateTeam([mon(), mon()], ruleset);
    expect(result.team_issue_details?.map((d) => d.code)).toEqual(['species_clause', 'item_clause']);
    expect(validateTeam([mon(), mon()], makeRuleset({ clauses: ['Sleep Clause Mod'] })).team_issues).toEqual([]);
  });

  it('keeps the shared-type rule and the team constraints from the rules', () => {
    const shared = makeRuleset({ min_shared_type_pct: 100, clauses: [] });
    expect(validateTeam([mon(), mon({ species: 'Pikachu', ability: 'Static', item: 'Light Ball' })], shared).team_issue_details?.map((d) => d.code)).toEqual(['shared_type']);
    const tera = makeRuleset({ team_constraints: { tera_match: 'team_types' }, clauses: [] });
    expect(codes(validateTeam([mon({ tera_type: 'Fire' })], tera))).toContain('tera_type_mismatch');
  });
});
