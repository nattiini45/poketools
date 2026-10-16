import { describe, expect, it } from 'vitest';
import { outputLanguageInstruction, withOutputLanguage } from '../language';

describe('outputLanguageInstruction (i18n-core §6.4)', () => {
  it('asks for English in en', () => {
    expect(outputLanguageInstruction('en')).toBe('Write in English.');
  });

  it('asks for du-form German with official names, keeping Showdown blocks, numbers and JSON keys', () => {
    const de = outputLanguageInstruction('de');
    expect(de).toContain('Write all prose in German (du-Form).');
    expect(de).toContain('Use official German Pokémon, move, ability and item names');
    expect(de).toContain('keep Showdown export blocks and numbers unchanged');
    // Structured answers keep keys and the `pokemon` fields the UI renders sprites from.
    expect(de).toContain('keep every key, and every `pokemon` field, exactly as specified');
  });

  it('is itself written in English (the prompts stay English)', () => {
    expect(outputLanguageInstruction('de')).not.toMatch(/[äöüß]/);
  });
});

describe('withOutputLanguage', () => {
  it('changes the prompt only by appending the language line as its last paragraph', () => {
    const prompt = 'You are Professor Linden.\n\nRules:\n- Be concise.';
    for (const locale of ['en', 'de'] as const) {
      const out = withOutputLanguage(prompt, locale);
      expect(out.startsWith(prompt)).toBe(true);
      expect(out.slice(prompt.length)).toBe(`\n\n${outputLanguageInstruction(locale)}`);
    }
  });
});
