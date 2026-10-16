import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pkmnSearchKeys } from '../names';
import {
  MATCH_EXACT,
  MATCH_PREFIX,
  MATCH_SUBSTRING,
  MATCH_WORD_PREFIX,
  NO_MATCH,
  buildSearchKeys,
  compareDisplayNames,
  foldForSearch,
  matchRank,
  rankedSearch,
  searchVariantsOf,
  transliterateGerman,
} from '../search';
import type { PkmnKind } from '../types';

const SPECIES = [
  'Charizard-Mega-X',
  'Charizard',
  'Charmander',
  'Scream Tail',
  'Flabébé',
  'Nidoran-F',
  'Nidoran-M',
  'Type: Null',
  'Samurott-Hisui',
];
const MOVES = ['Follow Me', 'Spotlight', 'U-turn', 'Ceaseless Edge', 'Stealth Rock'];

const find = (kind: PkmnKind, names: readonly string[], q: string) =>
  rankedSearch(names, q, (n) => pkmnSearchKeys(kind, n));

describe('folding', () => {
  it('foldForSearch', () => {
    expect(foldForSearch('Flabébé')).toBe('flabebe');
    expect(foldForSearch('Type: Null')).toBe('type null');
    expect(foldForSearch('U-turn')).toBe('u turn');
    expect(foldForSearch('Nidoran♀')).toBe('nidoranf');
    expect(foldForSearch('Brüllschweif')).toBe('brullschweif');
    expect(foldForSearch('Weißgefiedert')).toBe('weissgefiedert');
    expect(foldForSearch('  Mega-Glurak  X ')).toBe('mega glurak x');
  });

  it('transliterateGerman', () => {
    expect(transliterateGerman('Brüllschweif')).toBe('bruellschweif');
    expect(transliterateGerman('ÜBERRESTE')).toBe('ueberreste');
    expect(transliterateGerman('Mäßig')).toBe('maessig');
    // Decomposed input (u + combining diaeresis) transliterates too.
    expect(transliterateGerman('Brüllschweif')).toBe('bruellschweif');
  });

  it('searchVariantsOf / buildSearchKeys dedupe and skip undefined', () => {
    expect(searchVariantsOf(['Pikachu', 'Pikachu', undefined])).toEqual(['pikachu']);
    expect(buildSearchKeys(['Mega-Glurak X', undefined])).toEqual({
      compact: ['megaglurakx'],
      words: ['mega', 'glurak', 'x'],
    });
  });
});

describe('§3.3 behaviour', () => {
  it.each(['Glurak', 'glurak', 'Charizard'])('%s finds Charizard first (exact)', (q) => {
    expect(find('species', SPECIES, q)[0]).toBe('Charizard');
    expect(matchRank(q, pkmnSearchKeys('species', 'Charizard'))).toBe(MATCH_EXACT);
  });

  it('Klingenschwall finds Ceaseless Edge', () => {
    expect(find('move', MOVES, 'Klingenschwall')).toEqual(['Ceaseless Edge']);
  });

  it.each(['brüllschweif', 'brullschweif', 'bruellschweif', 'Brüll'])('%s finds Scream Tail', (q) => {
    expect(find('species', SPECIES, q)).toContain('Scream Tail');
  });

  it.each(['flabebe', 'Flabébé'])('%s finds Flabébé', (q) => {
    expect(find('species', SPECIES, q)[0]).toBe('Flabébé');
  });

  it('"nidoran f" finds Nidoran-F, "typ null" finds Type: Null', () => {
    expect(find('species', SPECIES, 'nidoran f')[0]).toBe('Nidoran-F');
    expect(find('species', SPECIES, 'typ null')[0]).toBe('Type: Null');
  });

  it.each(['u-turn', 'uturn', 'kehrtwende'])('%s finds U-turn', (q) => {
    expect(find('move', MOVES, q)[0]).toBe('U-turn');
  });

  it('ranks Glurak (exact) before Mega-Glurak X, and by prefix for "glu"', () => {
    const exact = find('species', SPECIES, 'Glurak');
    expect(exact.indexOf('Charizard')).toBeLessThan(exact.indexOf('Charizard-Mega-X'));
    expect(matchRank('Glurak', pkmnSearchKeys('species', 'Charizard-Mega-X'))).toBe(MATCH_WORD_PREFIX);
    const prefix = find('species', SPECIES, 'glu');
    // Glurak and Glumanda (Charmander) match by prefix, Mega-Glurak X only by word prefix.
    expect(prefix).toEqual(['Charizard', 'Charmander', 'Charizard-Mega-X']);
    expect(matchRank('glu', pkmnSearchKeys('species', 'Charizard'))).toBe(MATCH_PREFIX);
  });

  it('both languages always match, whatever the locale', () => {
    expect(find('species', SPECIES, 'Charizard')).toContain('Charizard');
    expect(find('species', SPECIES, 'Glurak')).toContain('Charizard');
  });

  it('"spotlight" returns both Follow Me (German Spotlight) and Spotlight', () => {
    expect(find('move', MOVES, 'spotlight').sort()).toEqual(['Follow Me', 'Spotlight']);
  });

  it('substring and no match', () => {
    expect(matchRank('urak', pkmnSearchKeys('species', 'Charizard'))).toBe(MATCH_SUBSTRING);
    expect(matchRank('zzz', pkmnSearchKeys('species', 'Charizard'))).toBe(NO_MATCH);
    expect(find('species', SPECIES, 'zzz')).toEqual([]);
  });

  it('an empty query matches everything in input order', () => {
    expect(find('move', MOVES, '')).toEqual(MOVES);
    expect(find('move', MOVES, ' - ')).toEqual(MOVES);
  });
});

describe('rankedSearch', () => {
  const keys = (n: string) => buildSearchKeys([n]);

  it('is stable for equal ranks and applies limit after ranking', () => {
    const items = ['abc 2', 'xabc', 'abc 1', 'abc'];
    expect(rankedSearch(items, 'abc', keys)).toEqual(['abc', 'abc 2', 'abc 1', 'xabc']);
    expect(rankedSearch(items, 'abc', keys, { limit: 1 })).toEqual(['abc']);
    expect(rankedSearch(items, 'abc', keys, { limit: 0 })).toEqual([]);
  });

  it('uses tieBreak inside a rank, then input order', () => {
    const items = ['abc 2', 'abc 1', 'abc'];
    const out = rankedSearch(items, 'abc', keys, { tieBreak: (a, b) => a.localeCompare(b) });
    expect(out).toEqual(['abc', 'abc 1', 'abc 2']);
  });

  it('does not mutate its input', () => {
    const items = ['b', 'a'];
    rankedSearch(items, '', keys, { tieBreak: (a, b) => a.localeCompare(b) });
    expect(items).toEqual(['b', 'a']);
  });
});

describe('compareDisplayNames', () => {
  it('sorts German names with umlauts and numbers naturally', () => {
    const names = ['Zwirrfinst', 'Ätzlinge', 'Abra', 'Typ:Null', 'Item 10', 'Item 2'];
    expect([...names].sort((a, b) => compareDisplayNames(a, b, 'de'))).toEqual([
      'Abra',
      'Ätzlinge',
      'Item 2',
      'Item 10',
      'Typ:Null',
      'Zwirrfinst',
    ]);
    expect(compareDisplayNames('glurak', 'Glurak', 'en')).toBe(0);
  });
});

describe('module boundary', () => {
  it('search.ts imports nothing but ./id (+ the @/i18n/config constants and type-only ./types)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../search.ts'), 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]).sort();
    expect(specifiers).toEqual(['./id', './types', '@/i18n/config']);
    expect(source).toMatch(/import type \{ DataLocale \} from '\.\/types'/);
    expect(source).not.toMatch(/\.json'/);
  });
});
