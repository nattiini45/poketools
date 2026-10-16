import { describe, expect, it } from 'vitest';
import { buildSearchKeys } from '@/lib/pkmn/i18n/search';
import { foldQuery, lineMatchesText, stageMatchesText } from '../search';
import { prepareIndex } from '../prepare';
import { buildFixtureIndex, stubNames } from './fixture-index';

const keys = (en: string, de?: string) => buildSearchKeys([en, de]);
const matches = (q: string, en: string, de?: string) => stageMatchesText(keys(en, de), foldQuery(q));

describe('finder text search (draft-frontend §4.3)', () => {
  it('an empty or punctuation-only query matches everything', () => {
    expect(foldQuery('').variants).toEqual([]);
    expect(foldQuery(' - ').variants).toEqual([]);
    expect(matches('', 'Gengar')).toBe(true);
  });

  it('matches a compact prefix', () => {
    expect(matches('Samu', 'Samurott')).toBe(true);
    expect(matches('Samurott', 'Samurott-Hisui')).toBe(true);
  });

  it('word prefixes must each take a distinct word', () => {
    expect(matches('hisui samurott', 'Samurott-Hisui')).toBe(true);
    expect(matches('his sam', 'Samurott-Hisui')).toBe(true);
    expect(matches('sam sam', 'Samurott-Hisui')).toBe(false);
  });

  it('never matches a substring inside a word (form separation)', () => {
    expect(matches('Samurott-Hisui', 'Samurott', 'Admurai')).toBe(false);
    expect(matches('hisui', 'Samurott', 'Admurai')).toBe(false);
    expect(matches('urott', 'Samurott')).toBe(false);
  });

  it('matches German names and German transliteration whatever the locale', () => {
    expect(matches('blutmond', 'Ursaluna-Bloodmoon', 'Blutmond-Ursaluna')).toBe(true);
    expect(matches('bloodmoon', 'Ursaluna-Bloodmoon', 'Blutmond-Ursaluna')).toBe(true);
    // Real German name of Scream Tail; the umlaut is typed as "ue".
    expect(matches('bruellschweif', 'Scream Tail', 'Brüllschweif')).toBe(true);
    expect(matches('brüll', 'Scream Tail', 'Brüllschweif')).toBe(true);
    expect(matches('brull', 'Scream Tail', 'Brüllschweif')).toBe(true);
  });

  it('folds accents (Flabébé)', () => {
    expect(matches('flabebe', 'Flabébé')).toBe(true);
    expect(matches('Flabé', 'Flabébé')).toBe(true);
  });

  it('a line matches when some stage matches; the line label is never searched as one string', () => {
    const ix = prepareIndex(buildFixtureIndex(), stubNames);
    const hisui = ix.byLineId.get('oshawott--samurotthisui');
    const plain = ix.byLineId.get('oshawott--samurott');
    if (!hisui || !plain) throw new Error('fixture lines missing');
    expect(lineMatchesText(hisui, foldQuery('Oshawott'))).toBe(true);
    expect(lineMatchesText(plain, foldQuery('Ottaro'))).toBe(true);
    expect(lineMatchesText(plain, foldQuery('oshawott samurott'))).toBe(false);
  });
});
