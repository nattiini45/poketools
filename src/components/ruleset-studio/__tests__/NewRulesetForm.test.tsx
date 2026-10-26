/**
 * The "New ruleset" form (static markup): the four starts, the panel of each, the Smogon tour toggle (offered for the draft
 * presets, enabled only where the catalog has documented extras), the labelled file input and the import report.
 * Requests and navigation are not run here; the request layer has its own tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import type { ImportReport } from '@/lib/ruleset-studio/editor/import-file';
import { START_KINDS, type StartKind } from '@/lib/ruleset-studio/editor/starts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { NewRulesetForm, type NewRulesetData } from '../starts/NewRulesetDialog';

const DATA: NewRulesetData = { shared: [{ id: 'r1', name: 'Core Liga OU', version: 3 }] };

function render(over: { start?: StartKind; preset?: string; data?: Partial<NewRulesetData>; report?: ImportReport; locale?: Locale } = {}) {
  return renderWithI18n(
    <NewRulesetForm data={{ ...DATA, ...over.data }} initialStart={over.start} initialPreset={over.preset} initialImportReport={over.report} />,
    { locale: over.locale ?? 'en' },
  );
}

const tag = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';

describe('NewRulesetForm: the starts', () => {
  it.each(['en', 'de'] as const)('offers the four starts as one radio group, each with a label and a description (%s)', (locale) => {
    const html = render({ locale });
    const t = createTranslator(rulesetStudioMessages, locale);
    expect([...html.matchAll(/id="re-start-(\w+)"/g)].map((m) => m[1])).toEqual([...START_KINDS]);
    for (const kind of START_KINDS) {
      expect(html).toContain(esc(t(`new.start.${kind}`)));
      expect(html).toContain(esc(t(`new.start.${kind}Help`)));
      expect(html).toContain(`aria-describedby="re-start-${kind}-help"`);
    }
    expect(html).toContain('<fieldset');
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('starts on the blank start', () => {
    const html = render();
    expect(tag(html, 're-start-blank')).toContain('checked');
    expect(tag(html, 're-start-preset')).not.toContain('checked');
  });
});

describe('NewRulesetForm: blank', () => {
  it('asks for a name and the language, and has no preset picker', () => {
    const html = render();
    expect(html).toContain('for="re-new-name"');
    expect(html).toContain('Ruleset name');
    expect(html).toContain('<option value="en" selected="">English</option>');
    expect(html).toContain('<option value="de">Deutsch</option>');
    expect(html).toContain('Create ruleset');
    expect(html).not.toContain('re-new-preset');
    expect(html).not.toContain('re-new-tour');
  });

  it('the language starts at the viewer language', () => {
    expect(render({ locale: 'de' })).toContain('<option value="de" selected="">Deutsch</option>');
  });
});

describe('NewRulesetForm: from a rule preset', () => {
  it('shows the preset picker with Gen 9 OU chosen, and the name as optional', () => {
    const html = render({ start: 'preset' });
    expect(html).toContain('id="re-new-preset"');
    expect(html).toContain('<option value="gen9ou" selected="">Gen 9 OU</option>');
    expect(html).toContain('Ruleset name (optional)');
    expect(html).toContain('Leave it empty to use the preset’s own name.');
    expect(html).toContain('id="re-new-preset-help"');
    expectLabelledControls(html);
    expectUniqueIds(html);
    expectNoLeftovers(html);
  });

  it('does not show the Smogon tour toggle for a Showdown ladder preset', () => {
    const html = render({ start: 'preset', preset: 'gen9ou' });
    expect(html).not.toContain('re-new-tour');
    expect(html).not.toContain('Add Smogon tour bans');
  });

  it('shows the toggle, enabled and unchecked, for a draft preset with documented extras', () => {
    const html = render({ start: 'preset', preset: 'gen9natdexdraft' });
    const box = tag(html, 're-new-tour');
    expect(box).toContain('type="checkbox"');
    expect(box).not.toContain('disabled');
    expect(box).not.toContain('checked');
    expect(html).toContain('for="re-new-tour"');
    expect(html).toContain('Add Smogon tour bans');
    expect(html).toContain('as ordinary entries');
    expect(html).toContain('aria-describedby="re-new-tour-help"');
    expectLabelledControls(html);
  });

  it('shows the toggle disabled, with the reason, for a draft preset without documented extras', () => {
    const html = render({ start: 'preset', preset: 'gen9draft' });
    const box = tag(html, 're-new-tour');
    expect(box).toContain('disabled');
    expect(box).not.toContain('checked');
    expect(html).toContain('This preset has no documented Smogon tour extras.');
  });

  it.each(['en', 'de'] as const)('says the toggle in the viewer language (%s)', (locale) => {
    const html = render({ start: 'preset', preset: 'gen9natdexdraft', locale });
    expect(html).toContain(esc(createTranslator(rulesetStudioMessages, locale)('new.tourOverlay')));
  });
});

describe('NewRulesetForm: from a shared ruleset', () => {
  it('lists the shared rulesets with their version', () => {
    const html = render({ start: 'fork' });
    expect(html).toContain('for="re-new-fork"');
    expect(html).toContain('<option value="r1" selected="">Core Liga OU (version 3)</option>');
    expect(html).toContain('A copy takes the last published version into a private draft.');
    expect(html).toContain('>Copy ruleset<');
    expectLabelledControls(html);
  });

  it('says there is nothing to copy and disables the button when nothing is shared', () => {
    const html = render({ start: 'fork', data: { shared: [] } });
    expect(html).toContain('Nobody has shared a ruleset with you yet, so there is nothing to copy.');
    expect(html).not.toContain('re-new-fork');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

describe('NewRulesetForm: import', () => {
  it('has a labelled file input restricted to JSON, with the help text', () => {
    const html = render({ start: 'import' });
    expect(html).toContain('for="re-new-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain('aria-describedby="re-new-file-help"');
    expect(html).toContain('It is never run.');
    expect(html).toContain('Import as a private draft');
  });

  it('reports a valid document in one line', () => {
    const html = render({ start: 'import', report: { document: {}, issues: [] } });
    expect(html).toContain('role="status"');
    expect(html).toContain('The file is a valid ruleset document.');
  });

  it('lists the first twenty problems with their path and code, then how many more', () => {
    const issues = Array.from({ length: 23 }, (_, i) => ({ code: 'bad_id' as const, path: `/pokemon/ban/${i}` }));
    const html = render({ start: 'import', report: { document: {}, issues } });
    expect(html).toContain('23 problems in the file');
    expect(html).toContain('<code>/pokemon/ban/0</code>');
    expect(html).toContain('<code>bad_id</code>');
    expect(html).toContain('<code>/pokemon/ban/19</code>');
    expect(html).not.toContain('/pokemon/ban/20<');
    expect(html).toContain('and 3 more');
    expect(html).toContain('aria-labelledby="re-import-issues"');
    expectUniqueIds(html);
  });

  it('shows no report before a file is chosen', () => {
    const html = render({ start: 'import' });
    expect(html).not.toContain('role="status"');
  });
});
