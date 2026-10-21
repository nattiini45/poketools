import { describe, expect, it } from 'vitest';
import {
  germanName,
  germanSpecies,
  localizeAbility,
  localizeItem,
  localizeLineLabel,
  localizeMove,
  localizeMoveCategory,
  localizeName,
  localizeNature,
  localizeNatureLabel,
  localizeSpecies,
  localizeStat,
  localizeStatus,
  localizeTerrain,
  localizeType,
  localizeWeather,
  pkmnParamLocalizer,
  pkmnSearchKeys,
  pkmnSearchVariants,
  toID,
  type StatKey,
} from '../names';
import { germanMove } from '../names/moves';

describe('species', () => {
  it.each([
    ['Charizard', 'Glurak'],
    ['Ninetales-Alola', 'Alola-Vulnona'],
    ['Samurott-Hisui', 'Hisui-Admurai'],
    ['Ursaluna-Bloodmoon', 'Blutmond-Ursaluna'],
    ['Tauros-Paldea-Combat', 'Paldea-Tauros (Gefechtvariante)'],
    ['Charizard-Mega-X', 'Mega-Glurak X'],
    ['Pikachu', 'Pikachu'],
    ['Scream Tail', 'Brüllschweif'],
    ['Flabébé', 'Flabébé'],
    ['Urshifu-*', 'Wulaosu-*'],
    // The generated map has the cosmetic forme itself (PK-1 added cosmetic formes), so no prefix fallback here.
    ['Gastrodon-East', 'Östliches Gastrodon'],
    // Unknown forme: the longest known "-" prefix.
    ['Charizard-Starter', 'Glurak'],
    ['Unknownmon', 'Unknownmon'],
    ['', ''],
  ])('de: %s -> %s', (en, de) => {
    expect(localizeSpecies(en, 'de')).toBe(de);
  });

  it('resolves an id in de mode', () => {
    expect(localizeSpecies('ursalunabloodmoon', 'de')).toBe('Blutmond-Ursaluna');
  });

  it("'en' returns the input unchanged", () => {
    for (const name of ['Charizard', 'Ursaluna-Bloodmoon', 'Urshifu-*', 'charizard', 'Unknownmon']) {
      expect(localizeSpecies(name, 'en')).toBe(name);
    }
  });

  it('germanSpecies has no fallback and ignores prototype keys', () => {
    expect(germanSpecies('Charizard')).toBe('Glurak');
    expect(germanSpecies('Unknownmon')).toBeUndefined();
    expect(germanSpecies('constructor')).toBeUndefined();
    expect(germanSpecies('__proto__')).toBeUndefined();
    expect(localizeSpecies('constructor', 'de')).toBe('constructor');
  });

  it('localizeLineLabel', () => {
    expect(localizeLineLabel('Teddiursa', 'Ursaluna-Bloodmoon', 'de')).toBe('Teddiursa → Blutmond-Ursaluna');
    expect(localizeLineLabel('Teddiursa', null, 'de')).toBe('Teddiursa');
    expect(localizeLineLabel('Charmander', 'Charizard', 'de')).toBe('Glumanda → Glurak');
    expect(localizeLineLabel('Charmander', 'Charizard', 'en')).toBe('Charmander → Charizard');
    expect(localizeLineLabel('Charmander', null, 'en')).toBe('Charmander');
  });
});

describe('moves, items, abilities', () => {
  it.each([
    ['U-turn', 'Kehrtwende'],
    ['Ceaseless Edge', 'Klingenschwall'],
    ['Stealth Rock', 'Tarnsteine'],
    ['Hidden Power', 'Kraftreserve'],
    ['Hidden Power [Fire]', 'Kraftreserve (Feuer)'],
    ['Hidden Power Fire', 'Kraftreserve (Feuer)'],
    ['hiddenpowerice', 'Kraftreserve (Eis)'],
    ['Follow Me', 'Spotlight'],
  ])('move de: %s -> %s', (en, de) => {
    expect(localizeMove(en, 'de')).toBe(de);
  });

  it('an unknown Hidden Power type has no German name', () => {
    expect(germanMove('Hidden Power Bogus')).toBeUndefined();
    expect(localizeMove('Hidden Power Bogus', 'de')).toBe('Hidden Power Bogus');
  });

  it('items and abilities', () => {
    expect(localizeItem('Choice Scarf', 'de')).toBe('Wahlschal');
    expect(localizeItem('Leftovers', 'de')).toBe('Überreste');
    expect(localizeAbility('Guts', 'de')).toBe('Adrenalin');
    expect(localizeAbility("Mind's Eye", 'de')).toBe('Geistiges Auge');
  });

  it("'en' returns the input unchanged", () => {
    expect(localizeMove('U-turn', 'en')).toBe('U-turn');
    expect(localizeItem('Choice Scarf', 'en')).toBe('Choice Scarf');
    expect(localizeAbility('Guts', 'en')).toBe('Guts');
  });
});

describe('types, natures, stats, status, weather, terrain, categories', () => {
  it('types', () => {
    expect(localizeType('Fire', 'de')).toBe('Feuer');
    expect(localizeType('Stellar', 'de')).toBe('Stellar');
    expect(localizeType('???', 'de')).toBe('???');
    expect(localizeType('Fire', 'en')).toBe('Fire');
  });

  it('natures', () => {
    expect(localizeNature('Adamant', 'de')).toBe('Hart');
    expect(localizeNature('Adamant', 'en')).toBe('Adamant');
  });

  it('stats, short and long, both locales', () => {
    const keys: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    expect(keys.map((k) => localizeStat(k, 'en'))).toEqual(['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe']);
    expect(keys.map((k) => localizeStat(k, 'en', 'long'))).toEqual([
      'HP',
      'Attack',
      'Defense',
      'Sp. Atk',
      'Sp. Def',
      'Speed',
    ]);
    expect(keys.map((k) => localizeStat(k, 'de', 'short'))).toEqual([
      'KP',
      'Angr.',
      'Vert.',
      'Sp.-Angr.',
      'Sp.-Vert.',
      'Init.',
    ]);
    expect(keys.map((k) => localizeStat(k, 'de', 'long'))).toEqual([
      'KP',
      'Angriff',
      'Verteidigung',
      'Spezialangriff',
      'Spezialverteidigung',
      'Initiative',
    ]);
  });

  it('status', () => {
    expect(localizeStatus('brn', 'en')).toBe('BRN');
    expect(localizeStatus('tox', 'en', 'long')).toBe('Bad Poison');
    expect(localizeStatus('brn', 'de')).toBe('BRT');
    expect(localizeStatus('par', 'de', 'long')).toBe('Paralyse');
  });

  it('weather, terrain, categories', () => {
    expect(localizeWeather('Sun', 'de')).toBe('Sonne');
    expect(localizeWeather('Harsh Sunshine', 'de')).toBe('Extremes Sonnenlicht');
    expect(localizeWeather('Sun', 'en')).toBe('Sun');
    expect(localizeTerrain('Electric', 'de')).toBe('Elektrofeld');
    expect(localizeTerrain('Electric', 'en')).toBe('Electric');
    expect(localizeMoveCategory('Physical', 'de')).toBe('Physisch');
    expect(localizeMoveCategory('Special', 'de')).toBe('Spezial');
    expect(localizeMoveCategory('Status', 'en')).toBe('Status');
  });

  it('localizeNatureLabel', () => {
    expect(localizeNatureLabel('Adamant', 'atk', 'spa', 'de')).toBe('Hart (+Angr. / -Sp.-Angr.)');
    expect(localizeNatureLabel('Adamant', 'atk', 'spa', 'en')).toBe('Adamant (+Atk / -SpA)');
    expect(localizeNatureLabel('Hardy', '', '', 'de')).toBe('Robust');
    expect(localizeNatureLabel('Hardy', 'atk', 'atk', 'en')).toBe('Hardy');
  });
});

describe('cross-kind helpers', () => {
  it('germanName / localizeName dispatch by kind', () => {
    expect(germanName('species', 'Charizard')).toBe('Glurak');
    expect(germanName('move', 'U-turn')).toBe('Kehrtwende');
    expect(germanName('item', 'Leftovers')).toBe('Überreste');
    expect(germanName('ability', 'Guts')).toBe('Adrenalin');
    expect(germanName('type', 'Water')).toBe('Wasser');
    expect(germanName('nature', 'Timid')).toBe('Scheu');
    expect(localizeName('species', 'Charizard', 'de')).toBe('Glurak');
    expect(localizeName('species', 'Charizard', 'en')).toBe('Charizard');
  });

  it('pkmnParamLocalizer', () => {
    const de = pkmnParamLocalizer('de');
    expect(de('species', 'Charizard')).toBe('Glurak');
    expect(de('move', 'Stealth Rock')).toBe('Tarnsteine');
    expect(de('statShort', 'spa')).toBe('Sp.-Angr.');
    expect(de('stat', 'spe')).toBe('Initiative');
    expect(de('status', 'slp')).toBe('Schlaf');
    expect(de('weather', 'Rain')).toBe('Regen');
    expect(de('terrain', 'Misty')).toBe('Nebelfeld');
    expect(de('category', 'Physical')).toBe('Physisch');
    expect(de('statShort', 'bogus')).toBe('bogus');
    expect(de('weather', 'Fog')).toBe('Fog');
    expect(de('species', 'Unknownmon')).toBe('Unknownmon');
    const en = pkmnParamLocalizer('en');
    expect(en('species', 'Charizard')).toBe('Charizard');
    expect(en('statShort', 'spa')).toBe('SpA');
  });

  it('pkmnSearchVariants has English, folded German and the transliteration', () => {
    const variants = pkmnSearchVariants('species', 'Scream Tail');
    expect(variants).toContain('scream tail');
    expect(variants).toContain('brullschweif');
    expect(variants).toContain('bruellschweif');
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('pkmnSearchKeys covers both languages', () => {
    const keys = pkmnSearchKeys('move', 'U-turn');
    expect(keys.compact).toEqual(expect.arrayContaining(['uturn', 'kehrtwende']));
    expect(keys.words).toEqual(expect.arrayContaining(['u', 'turn', 'kehrtwende']));
  });

  it('re-exports toID', () => {
    expect(toID('Flabébé')).toBe('flabebe');
  });
});
