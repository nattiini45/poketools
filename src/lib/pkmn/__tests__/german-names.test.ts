import { describe, it, expect } from 'vitest';

// Real data, no mocks: the map is derived from the generated German dictionary (src/lib/pkmn/i18n/data)
// plus the reviewed legacy aliases, and validated against @pkmn/data (design pkmn-l10n.md §6).
import {
  GERMAN_TO_ENGLISH,
  translatePokemonName,
  validateAllTranslations,
} from '../german-names';
import { getGeneration } from '../dex';

function isRealSpeciesName(name: string): boolean {
  for (let gen = 9; gen >= 1; gen--) {
    if (getGeneration(gen).species.get(name)?.name === name) return true;
  }
  return false;
}

// ─── GERMAN_TO_ENGLISH map ────────────────────────────────────────

describe('GERMAN_TO_ENGLISH', () => {
  it('covers every official German species name (well over 1000 entries)', () => {
    expect(Object.keys(GERMAN_TO_ENGLISH).length).toBeGreaterThan(1300);
  });

  it.each([
    ['Arkani', 'Arcanine'],
    ['Aquana', 'Vaporeon'],
    ['Austos', 'Cloyster'],
    ['Glurak', 'Charizard'],
    ['Alola-Vulnona', 'Ninetales-Alola'],
    ['Hisui-Admurai', 'Samurott-Hisui'],
    ['Blutmond-Ursaluna', 'Ursaluna-Bloodmoon'],
    ['Paldea-Tauros (Gefechtvariante)', 'Tauros-Paldea-Combat'],
    ['Aerodactyl', 'Aerodactyl'],
  ])('maps the official name %s to %s', (german, english) => {
    expect(GERMAN_TO_ENGLISH[german]).toBe(english);
  });

  it.each([
    // The old literal map had these wrong (design §6): they now come from the PokeAPI dictionary.
    ['Zwirrfinst', 'Dusknoir'],
    ['Backel', 'Dachsbun'],
    ['Affiti', 'Grafaiai'],
    ['Irokex', 'Scrafty'],
  ])('corrects the old wrong pair %s → %s', (german, english) => {
    expect(GERMAN_TO_ENGLISH[german]).toBe(english);
  });

  it.each([
    ['Ursaluna-Blutmond', 'Ursaluna-Bloodmoon'],
    ['P-Tauros Aqua', 'Tauros-Paldea-Aqua'],
    ['Wolwerock-Z', 'Lycanroc-Dusk'],
    ['Wolwerock-T', 'Lycanroc'],
    ['Salmagnis-F', 'Basculegion-F'],
    ['Servol-M', 'Indeedee'],
    ['Arktillas', 'Avalugg'],
    ['Gierspenst-Truhe', 'Gimmighoul'],
  ])('keeps the reviewed legacy alias %s → %s', (alias, english) => {
    expect(GERMAN_TO_ENGLISH[alias]).toBe(english);
  });

  it('does not map "Marrikeck" (not a German name; must fail loudly)', () => {
    expect(GERMAN_TO_ENGLISH['Marrikeck']).toBeUndefined();
  });

  it('every value is a real @pkmn species name', () => {
    const bad = Object.entries(GERMAN_TO_ENGLISH).filter(([, english]) => !isRealSpeciesName(english));
    expect(bad).toEqual([]);
  });
});

// ─── translatePokemonName ─────────────────────────────────────────

describe('translatePokemonName', () => {
  it('translates a known German name to English', () => {
    expect(translatePokemonName('Arkani')).toBe('Arcanine');
  });

  it.each([
    ['Arkani', 'Arcanine'],
    ['Zwirrfinst', 'Dusknoir'],
    ['Backel', 'Dachsbun'],
    ['Affiti', 'Grafaiai'],
    ['Alola-Vulnona', 'Ninetales-Alola'],
    ['Blutmond-Ursaluna', 'Ursaluna-Bloodmoon'],
    ['Ursaluna-Blutmond', 'Ursaluna-Bloodmoon'],
    ['P-Tauros Aqua', 'Tauros-Paldea-Aqua'],
    ['Wolwerock-Z', 'Lycanroc-Dusk'],
  ])('%s → %s', (german, english) => {
    expect(translatePokemonName(german)).toBe(english);
  });

  it('resolves National Dex–only species (not in Gen 9)', () => {
    expect(translatePokemonName('Amigento')).toBe('Silvally');
    expect(translatePokemonName('Mega-Despotar')).toBe('Tyranitar-Mega');
  });

  it('falls back to a toID fold for spelling variants of case, spaces and punctuation', () => {
    expect(translatePokemonName('glurak')).toBe('Charizard');
    expect(translatePokemonName('Wulaosu-Fließend')).toBe('Urshifu-Rapid-Strike');
    expect(translatePokemonName('Zygarde 10%')).toBe('Zygarde-10%');
  });

  it('throws for unknown German names', () => {
    expect(() => translatePokemonName('Fakemon')).toThrow('Unknown German Pokémon name: "Fakemon"');
    expect(() => translatePokemonName('Marrikeck')).toThrow('Unknown German Pokémon name');
  });
});

// ─── validateAllTranslations ──────────────────────────────────────

describe('validateAllTranslations', () => {
  it('finds no invalid entry', () => {
    const result = validateAllTranslations();
    expect(result.invalid).toEqual([]);
    expect(result.valid.length).toBeGreaterThan(0);
  });

  it('includes arrow notation in valid entries', () => {
    for (const entry of validateAllTranslations().valid) {
      expect(entry).toContain('→');
    }
  });

  it('processes every entry in GERMAN_TO_ENGLISH', () => {
    const result = validateAllTranslations();
    expect(result.valid.length + result.invalid.length).toBe(Object.keys(GERMAN_TO_ENGLISH).length);
  });
});
