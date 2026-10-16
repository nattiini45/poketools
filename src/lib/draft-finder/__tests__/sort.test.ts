import { describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/config';
import { prepareIndex } from '../prepare';
import { sortLineIds, type SortContext } from '../sort';
import { buildFixtureCatalog, buildFixtureIndex, stubNames } from './fixture-index';

const ix = prepareIndex(buildFixtureIndex(), stubNames);
const catalog = buildFixtureCatalog();
const all = catalog.lines.map((l) => l.lineId);

function ctx(patch: Partial<SortContext> = {}): SortContext {
  return {
    catalog: new Map(catalog.lines.map((l) => [l.lineId, l])),
    ix,
    favorites: new Set(),
    names: stubNames,
    dataLocale: 'en',
    ...patch,
  };
}

describe('finder sorting (draft-frontend §4.7 rule 4)', () => {
  it('default = price desc', () => {
    expect(sortLineIds([...all].reverse(), 'default', ctx())).toEqual([
      'teddiursa--ursalunabloodmoon',
      'gastly--gengar',
      'teddiursa--ursaluna',
      'cosmog--solgaleo',
      'oshawott--samurotthisui',
      'mona--x',
      'monb--y',
      'oshawott--samurott',
    ]);
  });

  it('alpha = base display name, then final stage, per data locale', () => {
    const ids = ['oshawott--samurotthisui', 'oshawott--samurott', 'gastly--gengar'];
    expect(sortLineIds(ids, 'alpha', ctx())).toEqual(['gastly--gengar', 'oshawott--samurott', 'oshawott--samurotthisui']);
    // German: Admurai < Hisui-Admurai and Nebulak < Ottaro.
    expect(sortLineIds(ids, 'alpha', ctx({ dataLocale: 'de' }))).toEqual([
      'gastly--gengar',
      'oshawott--samurott',
      'oshawott--samurotthisui',
    ]);
    const flipped = { ...stubNames, species: (en: string, l: Locale) => (l === 'de' && en === 'Gastly' ? 'Zwirrlicht' : en) };
    expect(sortLineIds(ids, 'alpha', ctx({ dataLocale: 'de', names: flipped }))[2]).toBe('gastly--gengar');
  });

  it('favorites first, then default', () => {
    expect(sortLineIds(all, 'favorites', ctx({ favorites: new Set(['oshawott--samurott', 'mona--x']) })).slice(0, 3)).toEqual([
      'mona--x',
      'oshawott--samurott',
      'teddiursa--ursalunabloodmoon',
    ]);
  });

  it('stat sorts use the final stage, then default', () => {
    expect(sortLineIds(all, 'spe', ctx()).slice(0, 2)).toEqual(['mona--x', 'monb--y']);
    // BST: Ursaluna-Bloodmoon 555; Ursaluna 550 and Mony 550 tie, so the higher price goes first.
    expect(sortLineIds(all, 'bst', ctx()).slice(0, 3)).toEqual(['teddiursa--ursalunabloodmoon', 'teddiursa--ursaluna', 'monb--y']);
  });

  it('ids missing from the catalog go last', () => {
    expect(sortLineIds(['ghost--line', 'mona--x'], 'default', ctx())).toEqual(['mona--x', 'ghost--line']);
  });
});
