import { beforeEach, describe, expect, it } from 'vitest';
import { germanAbility } from '@/lib/pkmn/i18n/names/abilities';
import { germanItem } from '@/lib/pkmn/i18n/names/items';
import { germanType } from '@/lib/pkmn/i18n/names/misc';
import { germanMove } from '@/lib/pkmn/i18n/names/moves';
import { germanSpecies } from '@/lib/pkmn/i18n/names/species';
import {
  getWikiAbilityDetail,
  getWikiIndexRows,
  getWikiItemDetail,
  getWikiMoveDetail,
  getWikiSpeciesDetail,
  getWikiTeraTypes,
  getWikiTypeMatchups,
  resetWikiMemoForTests,
  resolveWikiTeraType,
  WIKI_DETAIL_MEMO_MAX,
  type WikiKind,
} from '../index-rows.server';

/**
 * The wiki's heavy `@pkmn/data` builds are memoized locale-free: the same
 * instance on every call, and nothing German in any value (translation happens after the lookup).
 */

const GERMAN_NAME: Record<WikiKind, (name: string) => string | undefined> = {
  species: germanSpecies,
  moves: germanMove,
  items: germanItem,
  abilities: germanAbility,
};

/**
 * Every German name of `kind` that is not also an English name of that kind, as a set. (A few German names
 * equal another entity's English name, e.g. a German move called "Spotlight".)
 */
function germanOnlyNames(kind: WikiKind, englishNames: readonly string[]): Set<string> {
  const english = new Set(englishNames);
  const out = new Set<string>();
  for (const name of englishNames) {
    const german = GERMAN_NAME[kind](name);
    if (german && !english.has(german)) out.add(german);
  }
  return out;
}

function stringValues(row: object): string[] {
  const out: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) out.push(...value.filter((v): v is string => typeof v === 'string'));
  }
  return out;
}

describe('wiki index rows (module memo)', () => {
  beforeEach(() => {
    resetWikiMemoForTests();
  });

  it.each<WikiKind>(['species', 'moves', 'items', 'abilities'])(
    'returns the same array instance on every call (%s)',
    (kind) => {
      const first = getWikiIndexRows(kind);
      const second = getWikiIndexRows(kind);
      expect(first.length).toBeGreaterThan(100);
      expect(second).toBe(first);
      expect(Object.isFrozen(first)).toBe(true);
    },
  );

  it.each<WikiKind>(['species', 'moves', 'items', 'abilities'])('holds no German string (%s)', (kind) => {
    const rows = getWikiIndexRows(kind);
    const german = germanOnlyNames(
      kind,
      rows.map((row) => row.name),
    );
    // The name map really has German names for this kind, so the check below is meaningful.
    expect(german.size).toBeGreaterThan(50);
    const germanTypes = new Set(
      ['Fire', 'Water', 'Grass', 'Electric', 'Dark', 'Dragon', 'Fighting', 'Ghost', 'Rock'].map(
        (type) => germanType(type) ?? type,
      ),
    );
    expect(germanTypes.has('Feuer')).toBe(true);
    for (const row of rows) {
      for (const value of stringValues(row)) {
        expect(german.has(value), `${kind} row ${row.name} holds the German string "${value}"`).toBe(false);
        expect(germanTypes.has(value)).toBe(false);
      }
    }
    // Spot checks: the English names are there, the German ones are not.
    const names = new Set(rows.map((row) => row.name));
    const sample: Record<WikiKind, [english: string, german: string]> = {
      species: ['Charizard', 'Glurak'],
      moves: ['Earthquake', 'Erdbeben'],
      items: ['Leftovers', 'Überreste'],
      abilities: ['Intimidate', 'Bedroher'],
    };
    const [english, germanName] = sample[kind];
    expect(names.has(english)).toBe(true);
    expect(names.has(germanName)).toBe(false);
  });

  it('keeps English type names in the species and move rows', () => {
    const charizard = getWikiIndexRows('species').find((row) => row.name === 'Charizard');
    expect(charizard?.types).toEqual(['Fire', 'Flying']);
    expect(charizard?.bst).toBe(534);
    const earthquake = getWikiIndexRows('moves').find((row) => row.name === 'Earthquake');
    expect(earthquake).toMatchObject({ type: 'Ground', category: 'Physical', basePower: 100 });
  });
});

describe('wiki detail data (bounded memo)', () => {
  beforeEach(() => {
    resetWikiMemoForTests();
  });

  it('returns the same entry instance for repeated lookups, by any spelling of the name', () => {
    const first = getWikiMoveDetail('Earthquake');
    expect(first).not.toBeNull();
    expect(getWikiMoveDetail('earthquake')).toBe(first);
    expect(first?.name).toBe('Earthquake');
    expect(first?.description).not.toMatch(/Pokémon auf dem Feld|Schaden/);

    expect(getWikiItemDetail('Leftovers')).toBe(getWikiItemDetail('leftovers'));
    expect(getWikiAbilityDetail('Intimidate')).toBe(getWikiAbilityDetail('Intimidate'));
    const charizard = getWikiSpeciesDetail('Charizard');
    expect(charizard).toBe(getWikiSpeciesDetail('charizard'));
    expect(charizard?.types).toEqual(['Fire', 'Flying']);
    expect(charizard?.legalAbilities.some((a) => a.slot === 'H' && a.name === 'Solar Power')).toBe(true);
  });

  it('returns null for unknown names (and never stores them)', () => {
    expect(getWikiMoveDetail('Not A Move')).toBeNull();
    expect(getWikiItemDetail('')).toBeNull();
    expect(getWikiSpeciesDetail('Glurak')).toBeNull();
  });

  it('evicts the oldest entry past the cap', () => {
    const moves = getWikiIndexRows('moves').slice(0, WIKI_DETAIL_MEMO_MAX + 1);
    expect(moves).toHaveLength(WIKI_DETAIL_MEMO_MAX + 1);
    const oldest = getWikiMoveDetail(moves[0].name);
    for (const move of moves.slice(1)) getWikiMoveDetail(move.name);
    // The first entry was evicted, so a new lookup builds a new (equal) object.
    const rebuilt = getWikiMoveDetail(moves[0].name);
    expect(rebuilt).not.toBe(oldest);
    expect(rebuilt).toEqual(oldest);
  });
});

describe('wiki tera types', () => {
  it('lists the 18 battle types in game order, then Stellar, as English names', () => {
    const types = getWikiTeraTypes();
    expect(types).toHaveLength(19);
    expect(types[0]).toBe('Normal');
    expect(types[1]).toBe('Fire');
    expect(types[types.length - 1]).toBe('Stellar');
    expect(getWikiTeraTypes()).toBe(types);
  });

  it('resolves a URL segment in any case to the English type, and rejects German or unknown names', () => {
    expect(resolveWikiTeraType('fire')).toBe('Fire');
    expect(resolveWikiTeraType('STELLAR')).toBe('Stellar');
    expect(resolveWikiTeraType('Feuer')).toBeNull();
    expect(resolveWikiTeraType('')).toBeNull();
  });

  it('builds matchups with English type names', () => {
    const fire = getWikiTypeMatchups('Fire');
    expect(fire?.defensive?.weakTo).toEqual(expect.arrayContaining(['Water', 'Ground', 'Rock']));
    expect(fire?.offensive.superEffective).toEqual(expect.arrayContaining(['Grass', 'Ice', 'Bug', 'Steel']));
    expect(getWikiTypeMatchups('Fire')).toBe(fire);
    expect(getWikiTypeMatchups('Feuer')).toBeNull();
  });
});
