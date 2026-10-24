import { describe, expect, it } from 'vitest';
import {
  isTranslated,
  ltext,
  ltextEquals,
  markReviewed,
  missingLocales,
  resolveLText,
  withTranslation,
} from '../ltext';
import type { LText, Locale } from '../types';
import { validateFormatDefinition } from '../validate';
import { lt, minimalDoc } from './fixtures/docs';
import { setAt } from './fixtures/invalid';

const BOTH = ltext('en', 'Hello', 'Hallo');
const EN_ONLY = ltext('en', 'Hello');
const DE_ONLY = ltext('de', undefined, 'Hallo');
const DE_BASE_BOTH = ltext('de', 'Hello', 'Hallo');

describe('ltext builder', () => {
  it('builds both languages with a status', () => {
    expect(BOTH).toEqual({ base: 'en', en: { v: 'Hello', s: 'human' }, de: { v: 'Hallo', s: 'human' } });
    expect(ltext('en', 'Hello', 'Hallo', 'machine').de).toEqual({ v: 'Hallo', s: 'machine' });
  });

  it('refuses a text without a value for its base language', () => {
    expect(() => ltext('de', 'Hello')).toThrow(/base language de/);
    expect(() => ltext('en')).toThrow();
  });
});

describe('resolveLText order', () => {
  type Case = {
    label: string;
    text: LText;
    viewer?: Locale;
    seasonLanguage?: Locale;
    expected: { value: string; locale: Locale; fallback: boolean } | null;
  };
  const cases: Case[] = [
    { label: 'viewer en, both present', text: BOTH, viewer: 'en', expected: { value: 'Hello', locale: 'en', fallback: false } },
    { label: 'viewer de, both present', text: BOTH, viewer: 'de', expected: { value: 'Hallo', locale: 'de', fallback: false } },
    { label: 'viewer de, only en', text: EN_ONLY, viewer: 'de', expected: { value: 'Hello', locale: 'en', fallback: true } },
    { label: 'viewer en, only de', text: DE_ONLY, viewer: 'en', expected: { value: 'Hallo', locale: 'de', fallback: true } },
    { label: 'no viewer, base en', text: BOTH, expected: { value: 'Hello', locale: 'en', fallback: false } },
    { label: 'no viewer, base de', text: DE_BASE_BOTH, expected: { value: 'Hallo', locale: 'de', fallback: false } },
    { label: 'season language wins without a viewer', text: BOTH, seasonLanguage: 'de', expected: { value: 'Hallo', locale: 'de', fallback: false } },
    { label: 'viewer beats season language', text: BOTH, viewer: 'en', seasonLanguage: 'de', expected: { value: 'Hello', locale: 'en', fallback: false } },
    {
      label: 'viewer missing falls to the season language, which is flagged as a fallback',
      text: EN_ONLY,
      viewer: 'de',
      seasonLanguage: 'en',
      expected: { value: 'Hello', locale: 'en', fallback: true },
    },
    {
      label: 'season language missing falls to the base',
      text: ltext('en', 'Hello'),
      seasonLanguage: 'de',
      expected: { value: 'Hello', locale: 'en', fallback: true },
    },
    {
      label: 'viewer and season missing fall to the base',
      text: DE_ONLY,
      viewer: 'en',
      seasonLanguage: 'en',
      expected: { value: 'Hallo', locale: 'de', fallback: true },
    },
    { label: 'nothing present', text: { base: 'en' }, viewer: 'en', expected: null },
  ];

  for (const c of cases) {
    it(c.label, () => {
      expect(resolveLText(c.text, { viewer: c.viewer, seasonLanguage: c.seasonLanguage })).toEqual(c.expected);
    });
  }

  it('resolves with no options', () => {
    expect(resolveLText(BOTH)).toEqual({ value: 'Hello', locale: 'en', fallback: false });
  });

  it('returns a machine text like any other and never prefers another language over it', () => {
    const mixed: LText = { base: 'en', en: { v: 'Hello', s: 'human' }, de: { v: 'Hallo (maschinell)', s: 'machine' } };
    expect(resolveLText(mixed, { viewer: 'de' })).toEqual({ value: 'Hallo (maschinell)', locale: 'de', fallback: false });
    expect(resolveLText(mixed, { viewer: 'en' })?.value).toBe('Hello');
  });

  it('survives a text that skipped validation', () => {
    expect(resolveLText({ base: 'xx', en: { v: 'Hi', s: 'human' } } as unknown as LText, { viewer: 'de' })?.value).toBe('Hi');
    expect(resolveLText({ base: 'en', en: 'nope' } as unknown as LText)).toBeNull();
    expect(resolveLText({ base: 'en', en: { v: '', s: 'human' } })).toBeNull();
    expect(resolveLText(null as unknown as LText)).toBeNull();
  });
});

describe('ltext helpers', () => {
  it('lists missing languages and translation state', () => {
    expect(missingLocales(BOTH)).toEqual([]);
    expect(missingLocales(EN_ONLY)).toEqual(['de']);
    expect(missingLocales(DE_ONLY)).toEqual(['en']);
    expect(missingLocales({ base: 'en' })).toEqual(['en', 'de']);
    expect(isTranslated(EN_ONLY, 'en')).toBe(true);
    expect(isTranslated(EN_ONLY, 'de')).toBe(false);
  });

  it('markReviewed marks one language without touching the input', () => {
    const input: LText = { base: 'en', en: { v: 'Hello', s: 'human' }, de: { v: 'Hallo', s: 'machine' } };
    const snapshot = JSON.parse(JSON.stringify(input)) as LText;
    const reviewed = markReviewed(input, 'de');
    expect(reviewed.de).toEqual({ v: 'Hallo', s: 'reviewed' });
    expect(reviewed.en).toEqual(input.en);
    expect(input).toEqual(snapshot);
    expect(reviewed).not.toBe(input);
  });

  it('markReviewed returns the same object when there is nothing to mark', () => {
    const input: LText = { base: 'en', en: { v: 'Hello', s: 'reviewed' } };
    expect(markReviewed(input, 'en')).toBe(input);
    expect(markReviewed(input, 'de')).toBe(input);
  });

  it('withTranslation adds or replaces a language immutably', () => {
    const snapshot = JSON.parse(JSON.stringify(EN_ONLY)) as LText;
    const added = withTranslation(EN_ONLY, 'de', 'Hallo', 'machine');
    expect(added.de).toEqual({ v: 'Hallo', s: 'machine' });
    expect(EN_ONLY).toEqual(snapshot);
    const replaced = withTranslation(added, 'de', 'Servus', 'human');
    expect(replaced.de).toEqual({ v: 'Servus', s: 'human' });
    expect(added.de).toEqual({ v: 'Hallo', s: 'machine' });
  });

  it('ltextEquals compares base, values and statuses', () => {
    expect(ltextEquals(BOTH, ltext('en', 'Hello', 'Hallo'))).toBe(true);
    expect(ltextEquals(BOTH, EN_ONLY)).toBe(false);
    expect(ltextEquals(EN_ONLY, ltext('en', 'Hello'))).toBe(true);
    expect(ltextEquals(BOTH, ltext('de', 'Hello', 'Hallo'))).toBe(false);
    expect(ltextEquals(BOTH, ltext('en', 'Hello', 'Hallo', 'machine'))).toBe(false);
    expect(ltextEquals(BOTH, ltext('en', 'Hello', 'Hallo!'))).toBe(false);
  });
});

describe('an empty LText is impossible by schema', () => {
  it('rejects a text with no language and a text whose base language is missing', () => {
    const empty = validateFormatDefinition(setAt(minimalDoc(), ['identity', 'name'], { base: 'en' }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues).toEqual([{ code: 'refine', pointer: '/identity/name', params: { rule: 'ltext_base_present' } }]);
    const none = validateFormatDefinition(setAt(minimalDoc(), ['identity', 'name'], {}));
    expect(none.ok).toBe(false);
    expect(validateFormatDefinition(setAt(minimalDoc(), ['identity', 'name'], lt('Fine'))).ok).toBe(true);
  });
});
