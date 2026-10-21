import { describe, expect, it } from 'vitest';
import { buildSortParam, parseSortParam, parseWikiSortParams } from '@/lib/ui/table-params';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { compareWikiSortValues } from '@/lib/wiki/sort';

describe('WikiIndex sort by display name (compareWikiSortValues)', () => {
  const sortByDisplayName = (names: string[], locale: 'en' | 'de') =>
    [...names]
      .map((name) => localizeSpecies(name, locale))
      .sort((a, b) => compareWikiSortValues(a, b, locale));

  it('sorts German display names, not the English order, in German', () => {
    // English: Charizard < Venusaur; German: Bisaflor < Glurak.
    expect(sortByDisplayName(['Venusaur', 'Charizard', 'Blastoise'], 'en')).toEqual([
      'Blastoise',
      'Charizard',
      'Venusaur',
    ]);
    expect(sortByDisplayName(['Venusaur', 'Charizard', 'Blastoise'], 'de')).toEqual([
      'Bisaflor',
      'Glurak',
      'Turtok',
    ]);
  });

  it('collates umlauts next to their base letter in German', () => {
    const sorted = ['Zubat', 'Äpfel', 'Abra', 'Bisasam'].sort((a, b) => compareWikiSortValues(a, b, 'de'));
    expect(sorted).toEqual(['Abra', 'Äpfel', 'Bisasam', 'Zubat']);
  });

  it('compares numbers numerically and puts missing values last', () => {
    expect([10, null, 2, undefined, 33].sort((a, b) => compareWikiSortValues(a, b, 'en'))).toEqual([
      2,
      10,
      33,
      null,
      undefined,
    ]);
    expect(compareWikiSortValues(Number.NaN, 1, 'en')).toBeGreaterThan(0);
  });
});

describe('WikiIndex URL sort=col-dir', () => {
  const sortColumns = ['name', 'bst', 'power'] as const;

  it('reads compound sort params from the URL', () => {
    expect(parseSortParam('name-asc', sortColumns, { column: 'name', direction: 'asc' })).toEqual({
      key: 'name',
      direction: 'asc',
    });
    expect(parseSortParam('bst-desc', sortColumns, { column: 'name', direction: 'asc' })).toEqual({
      key: 'bst',
      direction: 'desc',
    });
  });

  it('folds legacy sort + dir params', () => {
    expect(
      parseWikiSortParams('name', 'asc', sortColumns, { key: 'bst', direction: 'desc' }),
    ).toEqual({ key: 'name', direction: 'asc' });
    expect(
      parseWikiSortParams('power', 'desc', sortColumns, { key: 'name', direction: 'asc' }),
    ).toEqual({ key: 'power', direction: 'desc' });
  });

  it('writes compound sort params for bookmarkable URLs', () => {
    expect(buildSortParam('power', 'desc')).toBe('power-desc');
  });
});
