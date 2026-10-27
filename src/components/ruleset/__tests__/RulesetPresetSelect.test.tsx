/**
 * The rule preset picker (static markup): a labelled search box above a select grouped by source, generation and
 * family, the catalog's own preset names, an optional "none" entry, and an unknown id that stays selectable.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { groupRulesetPresets, listRulesetPresets } from '@/lib/pkmn/ruleset-preset-catalog';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import RulesetPresetSelect from '../RulesetPresetSelect';

const render = (props: Partial<Parameters<typeof RulesetPresetSelect>[0]> = {}, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<RulesetPresetSelect id="pick" label="Rule preset" value="gen9ou" onChange={() => undefined} {...props} />, { locale });

describe('RulesetPresetSelect', () => {
  it('lists every preset of the catalog once, Showdown first, newest generation first, with the chosen one selected', () => {
    const html = render();
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(listRulesetPresets().map((entry) => entry.id));
    expect(html.indexOf('label="Showdown · Gen 9 (SV) · Singles"')).toBeLessThan(html.indexOf('label="Showdown · Gen 1 (RBY) · Singles"'));
    expect(html.indexOf('label="Showdown · Gen 1 (RBY) · Singles"')).toBeLessThan(html.indexOf('label="Smogon draft · Gen 9 (SV) · Draft"'));
    expect(html).toContain('<option value="gen9ou" selected="">Gen 9 OU</option>');
    expect(html).toContain('<option value="gen9championsdraft">Gen 9 Champions Draft</option>');
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('has one group per source, generation and family, each named in words of the viewer language', () => {
    const groups = groupRulesetPresets(listRulesetPresets());
    expect([...render().matchAll(/<optgroup /g)]).toHaveLength(groups.length);
    expect(render()).toContain('label="Smogon draft · Gen 9 (SV) · Champions draft"');
    expect(render()).toContain('label="Showdown · Gen 9 (SV) · National Dex"');
    expect(render({}, 'de')).toContain('label="Smogon-Draft · Gen 9 (SV) · Champions-Draft"');
    expect(render({}, 'de')).toContain('label="Showdown · Gen 9 (SV) · Doppelkämpfe"');
  });

  it.each(['en', 'de'] as const)('labels the search box and explains it (%s)', (locale) => {
    const t = createTranslator(rulesetMessages, locale);
    const html = render({}, locale);
    expect(html).toContain('for="pick-search"');
    expect(html).toContain(esc(t('presetSelect.search')));
    expect(html).toContain(esc(t('presetSelect.searchHelp')));
    expect(html).toMatch(/<input[^>]*id="pick-search"[^>]*aria-describedby="[^"]+"/);
  });

  it('adds a "none" entry only when asked, and selects it for an empty value', () => {
    expect(render()).not.toContain('<option value="">');
    const html = render({ value: '', noneLabel: 'No rule preset' });
    expect(html).toContain('<option value="" selected="">No rule preset</option>');
    expect(html).not.toContain('selected=""">Gen');
  });

  it('keeps an id the catalog does not know as a selected, unknown entry', () => {
    expect(render({ value: 'gen99xx' })).toContain('<option value="gen99xx" selected="">Unknown rule preset (gen99xx)</option>');
    expect(render({ value: 'gen99xx' }, 'de')).toContain('Unbekanntes Regel-Preset (gen99xx)');
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
