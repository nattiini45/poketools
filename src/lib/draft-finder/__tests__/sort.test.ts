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
    sortStage: 'final',
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

  it('stat sorts read the base stage when asked', () => {
    const base = ctx({ sortStage: 'base' });
    // Base speed: Mona 40, every other line 60 (the fixture default), so the 60s keep the default order
    // (price desc) and Mona, first by final speed, comes last.
    expect(sortLineIds(all, 'spe', base)).toEqual([...sortLineIds(all, 'default', base).filter((id) => id !== 'mona--x'), 'mona--x']);
    // The same speed sort at the final stage puts Mona first: the stage changes the order.
    expect(sortLineIds(all, 'spe', ctx())[0]).toBe('mona--x');
    // BST at the base stage: Mona 240 against 360 elsewhere.
    expect(sortLineIds(all, 'bst', base).at(-1)).toBe('mona--x');
    expect(sortLineIds(all, 'bst', base)[0]).toBe('teddiursa--ursalunabloodmoon');
  });

  it('the stage only matters for stat sorts, and ties fall back to default at either stage', () => {
    for (const sort of ['default', 'alpha', 'favorites'] as const) {
      expect(sortLineIds(all, sort, ctx({ sortStage: 'base' }))).toEqual(sortLineIds(all, sort, ctx({ sortStage: 'final' })));
    }
    // Teddiursa lines tie on every base stat (the fixture default): default order decides, not the stage.
    const teddiursa = ['teddiursa--ursaluna', 'teddiursa--ursalunabloodmoon'];
    expect(sortLineIds(teddiursa, 'atk', ctx({ sortStage: 'base' }))).toEqual(['teddiursa--ursalunabloodmoon', 'teddiursa--ursaluna']);
  });

  it('a catalog line missing from the index sorts last in a stat sort, at either stage', () => {
    const entry = catalog.lines[0];
    const indexless = new Map([...ctx().catalog, ['ghost--line', { ...entry, lineId: 'ghost--line', price: 99 }]]);
    for (const sortStage of ['base', 'final'] as const) {
      expect(sortLineIds(['ghost--line', 'monb--y'], 'spe', ctx({ sortStage, catalog: indexless }))).toEqual(['monb--y', 'ghost--line']);
    }
  });

  it('ids missing from the catalog go last', () => {
    expect(sortLineIds(['ghost--line', 'mona--x'], 'default', ctx())).toEqual(['mona--x', 'ghost--line']);
  });
});
