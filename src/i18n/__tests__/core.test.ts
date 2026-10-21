import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, getMessages, interpolate, selectPlural, upperForPaint } from '../core';
import { defineDe, defineNamespace } from '../define';

const en = {
  hello: 'Hello {name}',
  plain: 'Plain text',
  score: 'Score: {points}',
  nested: { deep: { leaf: 'Deep leaf' } },
  count: { one: '{count} player', other: '{count} players' },
  countZero: { zero: 'No matches yet', one: '{count} match', other: '{count} matches' },
  englishOnly: 'Only English',
} as const;

const de = defineDe<typeof en>()({
  hello: 'Hallo {name}',
  plain: 'Einfacher Text',
  score: 'Punkte: {points}',
  nested: { deep: { leaf: 'Tiefes Blatt' } },
  count: { one: '{count} Spieler', other: '{count} Spieler' },
  countZero: { zero: 'Noch keine Spiele', one: '{count} Spiel', other: '{count} Spiele' },
  englishOnly: 'Nur Englisch',
});

const ns = defineNamespace('test/core', en, de);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTranslator', () => {
  it('interpolates params in both locales', () => {
    expect(createTranslator(ns, 'en')('hello', { name: 'Ash' })).toBe('Hello Ash');
    expect(createTranslator(ns, 'de')('hello', { name: 'Ash' })).toBe('Hallo Ash');
  });

  it('formats number params per locale', () => {
    expect(createTranslator(ns, 'en')('score', { points: 12345.5 })).toBe('Score: 12,345.5');
    expect(createTranslator(ns, 'de')('score', { points: 12345.5 })).toBe('Punkte: 12.345,5');
    // Four-digit numbers (years, small counts) stay ungrouped in both languages.
    expect(createTranslator(ns, 'en')('score', { points: 2026 })).toBe('Score: 2026');
  });

  it('selects plural forms (one / other / zero) in en and de', () => {
    const tEn = createTranslator(ns, 'en');
    const tDe = createTranslator(ns, 'de');
    expect(tEn('count', { count: 1 })).toBe('1 player');
    expect(tEn('count', { count: 3 })).toBe('3 players');
    expect(tDe('count', { count: 1 })).toBe('1 Spieler');
    expect(tEn('countZero', { count: 0 })).toBe('No matches yet');
    expect(tDe('countZero', { count: 0 })).toBe('Noch keine Spiele');
    expect(tDe('countZero', { count: 2 })).toBe('2 Spiele');
    // Without a zero form, 0 uses Intl plural rules ("other").
    expect(tEn('count', { count: 0 })).toBe('0 players');
  });

  it('resolves nested keys', () => {
    expect(createTranslator(ns, 'de')('nested.deep.leaf')).toBe('Tiefes Blatt');
  });

  it('memoizes per (namespace, locale)', () => {
    expect(createTranslator(ns, 'en')).toBe(createTranslator(ns, 'en'));
    expect(createTranslator(ns, 'en')).not.toBe(createTranslator(ns, 'de'));
    expect(createTranslator(ns, 'de').locale).toBe('de');
  });

  it('dynamic falls back: locale -> English -> fallback -> key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A de dictionary that lost a key through a cast: English is used.
    const broken = defineNamespace('test/broken', en, { ...de, plain: undefined } as unknown as typeof de);
    const t = createTranslator(broken, 'de');
    expect(t.dynamic('plain')).toBe('Plain text');
    expect(t.dynamic('nope.missing', undefined, 'Fallback')).toBe('Fallback');
    expect(t.dynamic('nope.missing2')).toBe('nope.missing2');
    expect(t.dynamic('hello', { name: 'Misty' })).toBe('Hallo Misty');
    expect(warn).toHaveBeenCalledWith('[i18n] missing', 'test/broken', 'plain');
  });

  it('has() reports dynamic keys', () => {
    const t = createTranslator(ns, 'de');
    expect(t.has('nested.deep.leaf')).toBe(true);
    expect(t.has('nested.deep')).toBe(false);
    expect(t.has('unknown')).toBe(false);
  });

  it('leaves a missing param visible and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = interpolate('Hi {who} and {other}', { who: 'Brock' }, 'en');
    expect(out).toBe('Hi Brock and {other}');
    expect(warn).toHaveBeenCalled();
  });

  it('getMessages returns the structured dictionary of a language', () => {
    expect(getMessages(ns, 'en').nested.deep.leaf).toBe('Deep leaf');
    expect(getMessages(ns, 'de').count.other).toBe('{count} Spieler');
  });
});

describe('selectPlural', () => {
  it('uses zero only for 0 when present', () => {
    expect(selectPlural({ zero: 'z', one: 'o', other: 'x' }, 0, 'de')).toBe('z');
    expect(selectPlural({ one: 'o', other: 'x' }, 1, 'de')).toBe('o');
    expect(selectPlural({ one: 'o', other: 'x' }, 1.5, 'en')).toBe('x');
  });
});

describe('upperForPaint', () => {
  it('upper-cases with locale rules (ß -> SS, never ẞ)', () => {
    expect(upperForPaint('Großes Finale', 'de')).toBe('GROSSES FINALE');
    expect(upperForPaint('Grand finals', 'en')).toBe('GRAND FINALS');
  });
});
