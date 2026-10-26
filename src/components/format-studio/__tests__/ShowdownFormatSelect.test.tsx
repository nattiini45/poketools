/**
 * The Showdown format picker (static markup): a labelled search box above a select grouped by generation, the
 * catalog's own format names, an optional "none" entry, and an unknown id that stays selectable.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { listShowdownFormats } from '@/lib/format-kit/client';
import ShowdownFormatSelect from '../ShowdownFormatSelect';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds } from './editor/test-helpers';

const render = (props: Partial<Parameters<typeof ShowdownFormatSelect>[0]> = {}, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<ShowdownFormatSelect id="pick" label="Showdown format" value="gen9ou" onChange={() => undefined} {...props} />, { locale });

describe('ShowdownFormatSelect', () => {
  it('lists every format of the catalog once, newest generation first, with the chosen one selected', () => {
    const html = render();
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(listShowdownFormats().map((f) => f.id));
    expect(html.indexOf('label="Gen 9 (SV)"')).toBeLessThan(html.indexOf('label="Gen 1 (RBY)"'));
    expect(html).toContain('<option value="gen9ou" selected="">Gen 9 OU</option>');
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it.each(['en', 'de'] as const)('labels the search box and explains it (%s)', (locale) => {
    const t = createTranslator(formatStudioEditorMessages, locale);
    const html = render({}, locale);
    expect(html).toContain('for="pick-search"');
    expect(html).toContain(esc(t('fields.showdownSearch')));
    expect(html).toContain(esc(t('fields.showdownSearchHelp')));
    expect(html).toMatch(/<input[^>]*id="pick-search"[^>]*aria-describedby="[^"]+"/);
  });

  it('adds a "none" entry only when asked, and selects it for an empty value', () => {
    expect(render()).not.toContain('<option value="">');
    const html = render({ value: '', noneLabel: 'No Showdown format' });
    expect(html).toContain('<option value="" selected="">No Showdown format</option>');
    expect(html).not.toContain('selected=""">Gen');
  });

  it('keeps an id the catalog does not know as a selected, unknown entry', () => {
    expect(render({ value: 'gen99xx' })).toContain('<option value="gen99xx" selected="">Unknown format (gen99xx)</option>');
    expect(render({ value: 'gen99xx' }, 'de')).toContain('Unbekanntes Format (gen99xx)');
  });

  it('marks the select invalid and tied to its message when asked', () => {
    const html = render({ invalid: true, describedBy: 'pick-err' });
    expect(html).toMatch(/<select[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<select[^>]*aria-describedby="pick-err"/);
  });

  it('can be disabled as a whole', () => {
    const html = render({ disabled: true });
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });
});
