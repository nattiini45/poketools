import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { rulesetStudioEditorMessages } from '@/i18n/messages/ruleset-studio/editor';
import { SHELL_KEYS, createShellText, type ShellText } from '../text';

interface Studio {
  name: string;
  text: (locale: Locale) => ShellText;
  has: (locale: Locale, key: string) => boolean;
  own: RegExp;
  foreign: RegExp;
}

const STUDIOS: readonly Studio[] = [
  {
    name: 'format',
    text: (locale) => createShellText(formatStudioEditorMessages, locale),
    has: (locale, key) => createTranslator(formatStudioEditorMessages, locale).has(key),
    own: /format/i,
    foreign: /ruleset|regelwerk/i,
  },
  {
    name: 'ruleset',
    text: (locale) => createShellText(rulesetStudioEditorMessages, locale),
    has: (locale, key) => createTranslator(rulesetStudioEditorMessages, locale).has(key),
    own: /ruleset|regelwerk/i,
    foreign: /format/i,
  },
];

const PARAMS = { n: 3, count: 2, time: '12:00', rev: 7 };

describe('the shell words', () => {
  it('are unique', () => {
    expect(new Set(SHELL_KEYS).size).toBe(SHELL_KEYS.length);
  });

  describe.each(STUDIOS)('in the $name studio\'s namespace', ({ text: textFor, has, own, foreign }) => {
    it.each(LOCALES)('has every key as a message (%s)', (locale) => {
      expect(SHELL_KEYS.filter((key) => !has(locale, key))).toEqual([]);
    });

    it.each(LOCALES)('fills every placeholder (%s)', (locale) => {
      const text = textFor(locale);
      for (const key of SHELL_KEYS) {
        const rendered = text(key, PARAMS);
        expect(rendered, key).not.toMatch(/\{[a-z]+\}/);
        expect(rendered, key).not.toBe(key);
      }
    });

    it('uses its own noun and the other studio\'s noun nowhere (English)', () => {
      const text = textFor('en');
      const all = SHELL_KEYS.map((key) => text(key, PARAMS));
      expect(all.filter((line) => foreign.test(line))).toEqual([]);
      expect(text('toolbar.back')).toMatch(own);
      expect(text('share.title')).toMatch(own);
      expect(text('fork.title')).toMatch(own);
    });

    it('uses its own noun in German too', () => {
      const text = textFor('de');
      expect(text('toolbar.back')).toMatch(own);
      expect(SHELL_KEYS.map((key) => text(key, PARAMS)).filter((line) => foreign.test(line))).toEqual([]);
    });
  });

  it('reads plural messages by count', () => {
    const text = createShellText(rulesetStudioEditorMessages, 'en');
    expect(text('toolbar.issues.errors', { count: 1 })).toBe('1 error');
    expect(text('toolbar.issues.errors', { count: 2 })).toBe('2 errors');
    expect(text('publish.blocked', { count: 1 })).toBe('Fix 1 error before publishing.');
  });
});
