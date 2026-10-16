import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import PkmnName from '../PkmnName';

describe('<PkmnName>', () => {
  it("renders the German name under a 'de' provider", () => {
    expect(renderWithI18n(<PkmnName kind="species" name="Charizard" />, { locale: 'de' })).toBe('Glurak');
    expect(renderWithI18n(<PkmnName kind="move" name="U-turn" />, { locale: 'de' })).toBe('Kehrtwende');
    expect(renderWithI18n(<PkmnName kind="type" name="Fire" />, { locale: 'de' })).toBe('Feuer');
  });

  it("renders the English name under an 'en' provider", () => {
    expect(renderWithI18n(<PkmnName kind="species" name="Charizard" />, { locale: 'en' })).toBe('Charizard');
  });

  it('follows the data locale, not the UI locale ("Keep Pokémon terms in English")', () => {
    expect(
      renderWithI18n(<PkmnName kind="item" name="Leftovers" />, { locale: 'de', dataLocale: 'en' }),
    ).toBe('Leftovers');
  });

  it('an explicit locale prop beats the provider', () => {
    expect(renderWithI18n(<PkmnName kind="species" name="Charizard" locale="en" />, { locale: 'de' })).toBe(
      'Charizard',
    );
    expect(renderWithI18n(<PkmnName kind="species" name="Charizard" locale="de" />, { locale: 'en' })).toBe(
      'Glurak',
    );
  });

  it('withEnglishTitle adds the English name as title only when it differs', () => {
    expect(
      renderWithI18n(<PkmnName kind="species" name="Charizard" withEnglishTitle />, { locale: 'de' }),
    ).toBe('<span title="Charizard">Glurak</span>');
    expect(renderWithI18n(<PkmnName kind="species" name="Pikachu" withEnglishTitle />, { locale: 'de' })).toBe(
      '<span>Pikachu</span>',
    );
    expect(
      renderWithI18n(<PkmnName kind="species" name="Charizard" withEnglishTitle />, { locale: 'en' }),
    ).toBe('<span>Charizard</span>');
  });

  it('className wraps the text in a span', () => {
    expect(
      renderWithI18n(<PkmnName kind="ability" name="Guts" className="font-bold" />, { locale: 'de' }),
    ).toBe('<span class="font-bold">Adrenalin</span>');
  });

  it("renders English without a provider ('en' fallback)", () => {
    expect(renderToStaticMarkup(<PkmnName kind="species" name="Charizard" />)).toBe('Charizard');
  });
});
