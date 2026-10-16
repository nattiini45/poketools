/**
 * The league create form: the content-language select (i18n-core §6.1, T04)
 * defaults to German for new leagues, shows a stored value, and the form
 * renders in both UI languages (react-dom/server, vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import LeagueForm from '../LeagueForm';

const noopSubmit = vi.fn(async () => null);

/** The `<select>` that follows the content-language label, as HTML. */
function languageSelect(html: string): string {
  const match = html.match(/<select[^>]*id="league-content-language"[^>]*>.*?<\/select>/s);
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

describe('LeagueForm content language', () => {
  it('defaults new leagues to German and offers both languages by their own names', () => {
    const html = renderToStaticMarkup(<LeagueForm rulesets={[]} onSubmit={noopSubmit} />);
    const select = languageSelect(html);

    expect(html).toContain('Content language (Discord, reports, overlays)');
    expect(select).toMatch(/<option value="de" selected="">Deutsch<\/option>/);
    expect(select).toMatch(/<option value="en">English<\/option>/);
  });

  it('shows the stored language of an existing league', () => {
    const html = renderToStaticMarkup(
      <LeagueForm rulesets={[]} onSubmit={noopSubmit} initialData={{ name: 'PLC', language: 'en' }} />,
    );

    expect(languageSelect(html)).toMatch(/<option value="en" selected="">English<\/option>/);
  });

  it('keeps the English labels and renders German ones under de', () => {
    const en = renderWithI18n(<LeagueForm rulesets={[]} onSubmit={noopSubmit} />);
    const de = renderWithI18n(<LeagueForm rulesets={[]} onSubmit={noopSubmit} />, { locale: 'de' });

    expect(en).toContain('League Name');
    expect(en).toContain('Create League');
    expect(en).toContain('Auto (format default)');
    expect(en).toContain('Evolution Point Buy');

    expect(de).toContain('Inhaltssprache (Discord, Berichte, Overlays)');
    expect(de).toContain('Name der Liga');
    expect(de).toContain('Liga erstellen');
    expect(de).toContain('Automatisch (Standard des Formats)');
    expect(de).toContain('Einzel');
    expect(de).not.toContain('League Name');
  });
});
