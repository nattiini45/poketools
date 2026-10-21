import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted mock data (accessible to vi.mock factories) ────────

const { mockGen, mockGens } = vi.hoisted(() => {

interface MockSpecies {
  name: string;
  id: string;
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  abilities: Record<string, string>;
  prevo?: string;
  evos?: string[];
  battleOnly?: boolean;
  isNonstandard?: boolean;
  exists: boolean;
}

interface MockMove {
  name: string;
  id: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  pp: number;
  shortDesc?: string;
  exists: boolean;
}

interface MockItem {
  name: string;
  id: string;
  shortDesc?: string;
  desc?: string;
  exists: boolean;
}

interface MockAbility {
  name: string;
  id: string;
  shortDesc?: string;
  desc?: string;
  exists: boolean;
}

interface MockType {
  id: string;
  name: string;
  damageTaken: Record<string, number>;
}

const MOCK_SPECIES: MockSpecies[] = [
  {
    name: 'Pikachu', id: 'pikachu', types: ['Electric'],
    baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
    abilities: { '0': 'Static', H: 'Lightning Rod' },
    evos: ['Raichu'], exists: true,
  },
  {
    name: 'Raichu', id: 'raichu', types: ['Electric'],
    baseStats: { hp: 60, atk: 90, def: 55, spa: 90, spd: 80, spe: 110 },
    abilities: { '0': 'Static', H: 'Lightning Rod' },
    prevo: 'Pikachu', exists: true,
  },
  {
    name: 'Bulbasaur', id: 'bulbasaur', types: ['Grass', 'Poison'],
    baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 },
    abilities: { '0': 'Overgrow', H: 'Chlorophyll' },
    evos: ['Ivysaur'], exists: true,
  },
  {
    name: 'Ivysaur', id: 'ivysaur', types: ['Grass', 'Poison'],
    baseStats: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60 },
    abilities: { '0': 'Overgrow', H: 'Chlorophyll' },
    prevo: 'Bulbasaur', evos: ['Venusaur'], exists: true,
  },
  {
    name: 'Venusaur', id: 'venusaur', types: ['Grass', 'Poison'],
    baseStats: { hp: 80, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 },
    abilities: { '0': 'Overgrow', H: 'Chlorophyll' },
    prevo: 'Ivysaur', exists: true,
  },
  {
    name: 'Eevee', id: 'eevee', types: ['Normal'],
    baseStats: { hp: 55, atk: 55, def: 50, spa: 45, spd: 65, spe: 55 },
    abilities: { '0': 'Run Away', '1': 'Adaptability', H: 'Anticipation' },
    evos: ['Vaporeon', 'Jolteon', 'Flareon'], exists: true,
  },
  {
    name: 'Charizard', id: 'charizard', types: ['Fire', 'Flying'],
    baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 },
    abilities: { '0': 'Blaze', H: 'Solar Power' },
    prevo: 'Charmeleon', exists: true, battleOnly: false,
  },
  {
    name: 'MegaCharizard', id: 'megacharizard', types: ['Fire', 'Dragon'],
    baseStats: { hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100 },
    abilities: { '0': 'Tough Claws' },
    exists: true, battleOnly: true,
  },
];

const MOCK_MOVES: MockMove[] = [
  { name: 'Thunderbolt', id: 'thunderbolt', type: 'Electric', category: 'Special', basePower: 90, accuracy: 100, pp: 15, shortDesc: 'Paralyze chance.', exists: true },
  { name: 'Flamethrower', id: 'flamethrower', type: 'Fire', category: 'Special', basePower: 90, accuracy: 100, pp: 15, shortDesc: 'Burn chance.', exists: true },
  { name: 'Tackle', id: 'tackle', type: 'Normal', category: 'Physical', basePower: 40, accuracy: 100, pp: 35, shortDesc: 'No extra effect.', exists: true },
];

const MOCK_ITEMS: MockItem[] = [
  { name: 'Leftovers', id: 'leftovers', shortDesc: 'Restores 1/16 max HP.', desc: 'Long desc leftovers.', exists: true },
  { name: 'Choice Scarf', id: 'choicescarf', shortDesc: 'Speed x1.5, locked into one move.', exists: true },
];

const MOCK_ABILITIES: MockAbility[] = [
  { name: 'Static', id: 'static', shortDesc: 'Contact: 30% paralyze.', exists: true },
  { name: 'Overgrow', id: 'overgrow', shortDesc: 'Low HP: Grass power 1.5x.', exists: true },
  { name: 'Lightning Rod', id: 'lightningrod', shortDesc: 'Draws Electric moves, raises SpA.', exists: true },
];

const MOCK_TYPES: MockType[] = [
  { id: 'electric', name: 'Electric', damageTaken: { Ground: 1, Flying: 2, Steel: 2, Electric: 2 } },
  { id: 'normal', name: 'Normal', damageTaken: { Fighting: 1, Ghost: 3 } },
  { id: 'fire', name: 'Fire', damageTaken: { Water: 1, Ground: 1, Rock: 1, Fire: 2, Grass: 2, Ice: 2, Bug: 2, Steel: 2, Fairy: 2 } },
  { id: 'flying', name: 'Flying', damageTaken: { Electric: 1, Ice: 1, Rock: 1, Ground: 3, Grass: 2, Fighting: 2, Bug: 2 } },
  { id: 'grass', name: 'Grass', damageTaken: { Fire: 1, Ice: 1, Poison: 1, Flying: 1, Bug: 1, Water: 2, Grass: 2, Electric: 2, Ground: 2 } },
  { id: 'poison', name: 'Poison', damageTaken: { Ground: 1, Psychic: 1, Fighting: 2, Poison: 2, Bug: 2, Grass: 2, Fairy: 2 } },
  { id: 'water', name: 'Water', damageTaken: { Electric: 1, Grass: 1, Fire: 2, Water: 2, Ice: 2, Steel: 2 } },
  { id: 'ground', name: 'Ground', damageTaken: { Water: 1, Grass: 1, Ice: 1, Electric: 3, Poison: 2, Rock: 2 } },
  { id: 'rock', name: 'Rock', damageTaken: { Water: 1, Grass: 1, Fighting: 1, Ground: 1, Steel: 1, Normal: 2, Fire: 2, Poison: 2, Flying: 2 } },
  { id: 'ice', name: 'Ice', damageTaken: { Fire: 1, Fighting: 1, Rock: 1, Steel: 1, Ice: 2 } },
  { id: 'bug', name: 'Bug', damageTaken: { Fire: 1, Flying: 1, Rock: 1, Fighting: 2, Grass: 2, Ground: 2 } },
  { id: 'steel', name: 'Steel', damageTaken: { Fire: 1, Fighting: 1, Ground: 1, Normal: 2, Grass: 2, Ice: 2, Flying: 2, Psychic: 2, Bug: 2, Rock: 2, Dragon: 2, Steel: 2, Fairy: 2, Poison: 3 } },
  { id: 'psychic', name: 'Psychic', damageTaken: { Bug: 1, Ghost: 1, Dark: 1, Fighting: 2, Psychic: 2 } },
  { id: 'ghost', name: 'Ghost', damageTaken: { Ghost: 1, Dark: 1, Normal: 3, Fighting: 3, Poison: 2, Bug: 2 } },
  { id: 'dark', name: 'Dark', damageTaken: { Fighting: 1, Bug: 1, Fairy: 1, Ghost: 2, Dark: 2, Psychic: 3 } },
  { id: 'dragon', name: 'Dragon', damageTaken: { Ice: 1, Dragon: 1, Fairy: 1, Fire: 2, Water: 2, Grass: 2, Electric: 2 } },
  { id: 'fairy', name: 'Fairy', damageTaken: { Poison: 1, Steel: 1, Fighting: 2, Bug: 2, Dark: 2, Dragon: 3 } },
  { id: 'fighting', name: 'Fighting', damageTaken: { Flying: 1, Psychic: 1, Fairy: 1, Bug: 2, Rock: 2, Dark: 2 } },
];

function makeIterableCollection<T extends { id: string; name: string }>(items: T[]) {
  return {
    get(nameOrId: string) {
      const lower = nameOrId.toLowerCase().replace(/[\s-]/g, '');
      return items.find(
        (x) => x.id === lower || x.name.toLowerCase().replace(/[\s-]/g, '') === lower
      ) ?? undefined;
    },
    [Symbol.iterator]() {
      return items[Symbol.iterator]();
    },
  };
}

const mockGen = {
  species: makeIterableCollection(MOCK_SPECIES),
  moves: makeIterableCollection(MOCK_MOVES),
  items: makeIterableCollection(MOCK_ITEMS),
  abilities: makeIterableCollection(MOCK_ABILITIES),
  types: makeIterableCollection(MOCK_TYPES),
  learnsets: {
    learnable: vi.fn(async (): Promise<Record<string, boolean> | null> => ({
      thunderbolt: true,
      tackle: true,
    })),
  },
};

const mockGens = {
  get: vi.fn(() => mockGen),
};

return { mockGen, mockGens };
});

vi.mock('@pkmn/dex', () => ({
  Dex: {},
}));

vi.mock('@pkmn/data', () => ({
  Generations: function () { return mockGens; },
}));

// ─── Import the module under test ──────────────────────────────────
import {
  getGeneration,
  getSpecies,
  getMove,
  getItem,
  getAbility,
  searchSpecies,
  searchMoves,
  searchItems,
  searchAbilities,
  searchMovesRich,
  searchItemsRich,
  searchAbilitiesRich,
  searchSpeciesRich,
  searchItemsByDescription,
  searchAbilitiesByDescription,
  searchMovesForSpecies,
  listMovesForSpecies,
  searchAbilitiesForSpecies,
  getBaseStats,
  getSpeciesInfoBatch,
  getLegalAbilities,
  checkMoveLegality,
  validateSetLegality,
  resolveEvoChain,
  searchBaseFormSpecies,
  getSpeciesTypeInfo,
  getTeamTypeAnalysis,
  listAllSpeciesRich,
  getAllMoves,
  getAllItems,
  getAllAbilities,
  getAllMovesNatDex,
  getAllItemsNatDex,
  getAllAbilitiesNatDex,
  listAllSpeciesNatDex,
  getSpeciesNatDex,
  getMoveNatDex,
  getItemNatDex,
  getAbilityNatDex,
} from '../dex';

describe('dex wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Basic getters ──────────────────────────────────────────────

  it('getGeneration delegates to gens.get', () => {
    const gen = getGeneration(9);
    expect(mockGens.get).toHaveBeenCalledWith(9);
    expect(gen).toBe(mockGen);
  });

  it('getGeneration defaults to gen 9', () => {
    getGeneration();
    expect(mockGens.get).toHaveBeenCalledWith(9);
  });

  it('getSpecies finds a species by name', () => {
    const species = getSpecies('Pikachu');
    expect(species?.name).toBe('Pikachu');
  });

  it('getSpecies returns undefined for unknown species', () => {
    expect(getSpecies('FakeMon')).toBeUndefined();
  });

  it('getMove finds a move by name', () => {
    const move = getMove('Thunderbolt');
    expect(move?.name).toBe('Thunderbolt');
  });

  it('getItem finds an item by name', () => {
    const item = getItem('Leftovers');
    expect(item?.name).toBe('Leftovers');
  });

  it('getAbility finds an ability by name', () => {
    const ability = getAbility('Static');
    expect(ability?.name).toBe('Static');
  });

  // ─── NatDex resolvers (walk gens 1–9, return earliest + most-recent) ─

  it('getSpeciesNatDex resolves species and reports earliest+resolved gens', () => {
    const result = getSpeciesNatDex('Pikachu');
    expect(result).not.toBeNull();
    expect(result?.entity.name).toBe('Pikachu');
    expect(result?.earliestGen).toBe(1);
    expect(result?.resolvedGen).toBe(9);
  });

  it('getSpeciesNatDex skips battleOnly forms (Mega in our fixture)', () => {
    // MegaCharizard is fixture-flagged battleOnly: true → should not resolve
    expect(getSpeciesNatDex('MegaCharizard')).toBeNull();
  });

  it('getSpeciesNatDex returns null for unknown species', () => {
    expect(getSpeciesNatDex('FakeMon')).toBeNull();
  });

  it('getMoveNatDex resolves a move that exists across all gens', () => {
    const result = getMoveNatDex('Thunderbolt');
    expect(result?.entity.name).toBe('Thunderbolt');
    expect(result?.earliestGen).toBe(1);
    expect(result?.resolvedGen).toBe(9);
  });

  it('getMoveNatDex returns null for unknown moves', () => {
    expect(getMoveNatDex('FakeMove')).toBeNull();
  });

  it('getItemNatDex resolves an item that exists across all gens', () => {
    const result = getItemNatDex('Leftovers');
    expect(result?.entity.name).toBe('Leftovers');
    expect(result?.earliestGen).toBe(1);
    expect(result?.resolvedGen).toBe(9);
  });

  it('getItemNatDex returns null for unknown items', () => {
    expect(getItemNatDex('FakeItem')).toBeNull();
  });

  it('getAbilityNatDex resolves an ability that exists across all gens', () => {
    const result = getAbilityNatDex('Static');
    expect(result?.entity.name).toBe('Static');
    expect(result?.earliestGen).toBe(1);
    expect(result?.resolvedGen).toBe(9);
  });

  it('getAbilityNatDex returns null for unknown abilities', () => {
    expect(getAbilityNatDex('FakeAbility')).toBeNull();
  });

  // ─── Search functions ────────────────────────────────────────────

  it('searchSpecies filters by query', () => {
    const results = searchSpecies('pika');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Pikachu');
  });

  it('searchSpecies respects limit', () => {
    const results = searchSpecies('', 9, 2);
    expect(results.length).toBe(2);
  });

  it('searchMoves filters by query', () => {
    const results = searchMoves('thunder');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Thunderbolt');
  });

  it('searchItems filters by query', () => {
    const results = searchItems('left');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Leftovers');
  });

  it('searchAbilities filters by query', () => {
    const results = searchAbilities('static');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Static');
  });

  // ─── Bilingual ranked search (pkmn-l10n §4.1; real-data cases in dex-l10n.test.ts) ──

  it('searchSpecies matches the German name and ranks the exact match first', () => {
    // German Charizard = "Glurak"; "MegaCharizard" (fixture name) has no German entry.
    expect(searchSpecies('Glurak').map((r) => r.name)).toEqual(['Charizard']);
    // "char": Charizard is a prefix match, MegaCharizard only a substring match.
    expect(searchSpecies('char').map((r) => r.name)).toEqual(['Charizard', 'MegaCharizard']);
  });

  it('searchMoves / searchItems / searchAbilities match German names', () => {
    expect(searchMoves('Donnerblitz')[0].name).toBe('Thunderbolt');
    expect(searchItems('wahlschal')[0].name).toBe('Choice Scarf');
    expect(searchItems('uberreste')[0].name).toBe('Leftovers');
    expect(searchAbilities('Statik')[0].name).toBe('Static');
  });

  it('orders equal ranks by English name (was dex order) and applies limit after ranking', () => {
    expect(searchMoves('').map((r) => r.name)).toEqual(['Flamethrower', 'Tackle', 'Thunderbolt']);
    expect(searchMoves('', 9, 1).map((r) => r.name)).toEqual(['Flamethrower']);
  });

  it('searchBaseFormSpecies matches the German base-form name', () => {
    expect(searchBaseFormSpecies('Bisasam')).toEqual([
      { name: 'Bulbasaur', id: 'bulbasaur', stage2: 'Ivysaur', stage3: 'Venusaur' },
    ]);
  });

  it('searchAbilitiesForSpecies returns @pkmn ids (toID) and matches German names', () => {
    const results = searchAbilitiesForSpecies('Blitzfänger', 'Pikachu');
    expect(results).toEqual([
      { name: 'Lightning Rod', id: 'lightningrod', shortDesc: 'Draws Electric moves, raises SpA.' },
    ]);
  });

  // ─── Rich search functions ──────────────────────────────────────

  it('searchMovesRich returns full move data', () => {
    const results = searchMovesRich('thunder');
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      name: 'Thunderbolt',
      type: 'Electric',
      category: 'Special',
      basePower: 90,
      pp: 15,
    });
  });

  it('searchItemsRich returns item with shortDesc', () => {
    const results = searchItemsRich('left');
    expect(results.length).toBe(1);
    expect(results[0].shortDesc).toContain('1/16');
  });

  it('searchAbilitiesRich returns ability with shortDesc', () => {
    const results = searchAbilitiesRich('static');
    expect(results.length).toBe(1);
    expect(results[0].shortDesc).toContain('paralyze');
  });

  it('searchSpeciesRich returns types and baseStats', () => {
    const results = searchSpeciesRich('pikachu');
    expect(results.length).toBe(1);
    expect(results[0].types).toEqual(['Electric']);
    expect(results[0].baseStats.spe).toBe(90);
  });

  // ─── Description search ──────────────────────────────────────────

  it('searchItemsByDescription matches terms in desc or name', () => {
    const results = searchItemsByDescription('restores');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Leftovers');
  });

  it('searchAbilitiesByDescription matches terms', () => {
    const results = searchAbilitiesByDescription('paralyze');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Static');
  });

  // ─── Species-specific functions ──────────────────────────────────

  it('searchMovesForSpecies returns learnable moves matching query', async () => {
    const results = await searchMovesForSpecies('thunder', 'Pikachu');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Thunderbolt');
  });

  it('searchMovesForSpecies falls back to searchMovesRich for unknown species', async () => {
    const results = await searchMovesForSpecies('thunder', 'FakeMon');
    // Falls back to global search
    expect(results.length).toBe(1);
  });

  it('searchMovesForSpecies returns empty when learnable is null', async () => {
    mockGen.learnsets.learnable.mockResolvedValueOnce(null as never);
    const results = await searchMovesForSpecies('thunder', 'Pikachu');
    expect(results).toEqual([]);
  });

  it('searchMovesForSpecies respects limit', async () => {
    mockGen.learnsets.learnable.mockResolvedValueOnce({
      thunderbolt: true,
      tackle: true,
      flamethrower: true,
    });
    const results = await searchMovesForSpecies('', 'Pikachu', 9, 1);
    expect(results.length).toBe(1);
  });

  it('listMovesForSpecies lists all moves sorted alphabetically', async () => {
    mockGen.learnsets.learnable.mockResolvedValueOnce({
      thunderbolt: true,
      tackle: true,
    });
    const results = await listMovesForSpecies('Pikachu');
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Tackle');
    expect(results[1].name).toBe('Thunderbolt');
  });

  it('listMovesForSpecies returns empty for unknown species', async () => {
    const results = await listMovesForSpecies('FakeMon');
    expect(results).toEqual([]);
  });

  it('listMovesForSpecies returns empty when learnable is null', async () => {
    mockGen.learnsets.learnable.mockResolvedValueOnce(null as never);
    const results = await listMovesForSpecies('Pikachu');
    expect(results).toEqual([]);
  });

  it('searchAbilitiesForSpecies returns legal abilities matching query', () => {
    const results = searchAbilitiesForSpecies('static', 'Pikachu');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Static');
  });

  it('searchAbilitiesForSpecies falls back for unknown species', () => {
    const results = searchAbilitiesForSpecies('static', 'FakeMon');
    // Falls back to global searchAbilitiesRich
    expect(results.length).toBe(1);
  });

  // ─── Base stats / batch ──────────────────────────────────────────

  it('getBaseStats returns stats for known species', () => {
    const result = getBaseStats('Pikachu');
    expect(result).toMatchObject({
      name: 'Pikachu',
      types: ['Electric'],
      baseStats: { hp: 35, spe: 90 },
    });
  });

  it('getBaseStats returns null for unknown species', () => {
    expect(getBaseStats('FakeMon')).toBeNull();
  });

  it('getSpeciesInfoBatch returns info for multiple species', () => {
    const results = getSpeciesInfoBatch(['Pikachu', 'Bulbasaur', 'FakeMon']);
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Pikachu');
    expect(results[1].name).toBe('Bulbasaur');
  });

  // ─── Legality checks ────────────────────────────────────────────

  it('getLegalAbilities returns ability slots', () => {
    const abilities = getLegalAbilities('Pikachu');
    expect(abilities).toEqual([
      { name: 'Static', slot: '0' },
      { name: 'Lightning Rod', slot: 'H' },
    ]);
  });

  it('getLegalAbilities returns empty for unknown species', () => {
    expect(getLegalAbilities('FakeMon')).toEqual([]);
  });

  it('checkMoveLegality marks learnable moves as legal', async () => {
    const results = await checkMoveLegality('Pikachu', ['Thunderbolt', 'Tackle']);
    expect(results).toEqual([
      { move: 'Thunderbolt', legal: true },
      { move: 'Tackle', legal: true },
    ]);
  });

  it('checkMoveLegality marks unknown species moves as illegal', async () => {
    const results = await checkMoveLegality('FakeMon', ['Thunderbolt']);
    expect(results).toEqual([{ move: 'Thunderbolt', legal: false }]);
  });

  it('checkMoveLegality treats empty move slot as legal', async () => {
    const results = await checkMoveLegality('Pikachu', ['']);
    expect(results).toEqual([{ move: '', legal: true }]);
  });

  it('checkMoveLegality marks unknown moves as illegal', async () => {
    const results = await checkMoveLegality('Pikachu', ['FakeMove']);
    expect(results).toEqual([{ move: 'FakeMove', legal: false }]);
  });

  it('validateSetLegality returns full result', async () => {
    const result = await validateSetLegality('Pikachu', 'Static', ['Thunderbolt']);
    expect(result.species).toBe('Pikachu');
    expect(result.abilityLegal).toBe(true);
    expect(result.abilities.length).toBeGreaterThan(0);
    expect(result.moveIssues[0]).toEqual({ move: 'Thunderbolt', legal: true });
  });

  it('validateSetLegality flags illegal ability', async () => {
    const result = await validateSetLegality('Pikachu', 'Intimidate', []);
    expect(result.abilityLegal).toBe(false);
  });

  it('validateSetLegality treats empty ability as legal', async () => {
    const result = await validateSetLegality('Pikachu', '', []);
    expect(result.abilityLegal).toBe(true);
  });

  // ─── Evolution chains ────────────────────────────────────────────

  it('resolveEvoChain finds a 3-stage line', () => {
    const chain = resolveEvoChain('Ivysaur');
    expect(chain).toEqual({
      base: 'Bulbasaur',
      stage2: 'Ivysaur',
      stage3: 'Venusaur',
    });
  });

  it('resolveEvoChain returns null for unknown species', () => {
    expect(resolveEvoChain('FakeMon')).toBeNull();
  });

  it('resolveEvoChain returns null for 2-stage line (Pikachu → Raichu)', () => {
    // Raichu has no evos, so the chain is only 2-stage
    expect(resolveEvoChain('Pikachu')).toBeNull();
  });

  it('resolveEvoChain returns null for branching evolution (Eevee)', () => {
    expect(resolveEvoChain('Eevee')).toBeNull();
  });

  it('searchBaseFormSpecies finds base forms of 3-stage lines', () => {
    const results = searchBaseFormSpecies('bulba');
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      name: 'Bulbasaur',
      stage2: 'Ivysaur',
      stage3: 'Venusaur',
    });
  });

  // ─── Type analysis ───────────────────────────────────────────────

  it('getSpeciesTypeInfo computes weaknesses, resistances, immunities', () => {
    const info = getSpeciesTypeInfo('Pikachu');
    expect(info).not.toBeNull();
    expect(info!.species).toBe('Pikachu');
    expect(info!.types).toEqual(['Electric']);
    // Electric is weak to Ground (damageTaken Ground=1 → 2x)
    expect(info!.weaknesses).toContain('Ground');
    // Electric resists Flying, Steel, Electric (damageTaken =2 → 0.5x)
    expect(info!.resistances).toContain('Flying');
  });

  it('getSpeciesTypeInfo returns null for unknown species', () => {
    expect(getSpeciesTypeInfo('FakeMon')).toBeNull();
  });

  it('getTeamTypeAnalysis computes team-wide weaknesses and resistances', () => {
    const analysis = getTeamTypeAnalysis(['Pikachu', 'Bulbasaur']);
    expect(analysis.pokemon.length).toBe(2);
    // teamWeaknesses: types that hit 2+ members super-effectively
    expect(Array.isArray(analysis.teamWeaknesses)).toBe(true);
    expect(Array.isArray(analysis.teamResistances)).toBe(true);
  });

  it('getTeamTypeAnalysis skips unknown species', () => {
    const analysis = getTeamTypeAnalysis(['Pikachu', 'FakeMon']);
    expect(analysis.pokemon.length).toBe(1);
  });

  // ─── Bulk listing ────────────────────────────────────────────────

  it('listAllSpeciesRich filters out battleOnly and nonstandard', () => {
    const results = listAllSpeciesRich();
    const names = results.map((r) => r.name);
    expect(names).not.toContain('MegaCharizard');
    expect(names).toContain('Pikachu');
  });

  it('listAllSpeciesRich is sorted alphabetically', () => {
    const results = listAllSpeciesRich();
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].name.localeCompare(results[i].name)).toBeLessThanOrEqual(0);
    }
  });

  it('getAllMoves returns all existing moves', () => {
    const results = getAllMoves();
    expect(results.length).toBe(3);
    expect(results[0]).toMatchObject({ name: 'Thunderbolt', type: 'Electric' });
  });

  it('getAllItems returns all existing items with desc', () => {
    const results = getAllItems();
    expect(results.length).toBe(2);
    expect(results[0].desc).toBeDefined();
  });

  it('getAllAbilities returns all existing abilities with desc', () => {
    const results = getAllAbilities();
    expect(results.length).toBe(3);
    expect(results[0].desc).toBeDefined();
  });

  // ─── NatDex helpers ──────────────────────────────────────────────

  it('getAllMovesNatDex iterates gens 1-9 and deduplicates', () => {
    const results = getAllMovesNatDex();
    expect(results.length).toBe(3);
    // Sorted alphabetically
    expect(results[0].name.localeCompare(results[1].name)).toBeLessThanOrEqual(0);
  });

  it('getAllItemsNatDex deduplicates across gens', () => {
    const results = getAllItemsNatDex();
    expect(results.length).toBe(2);
  });

  it('getAllAbilitiesNatDex deduplicates across gens', () => {
    const results = getAllAbilitiesNatDex();
    expect(results.length).toBe(3);
  });

  it('listAllSpeciesNatDex filters battleOnly and nonstandard', () => {
    const results = listAllSpeciesNatDex();
    const names = results.map((r) => r.name);
    expect(names).not.toContain('MegaCharizard');
  });
});
