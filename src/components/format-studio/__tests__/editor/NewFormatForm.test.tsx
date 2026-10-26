/**
 * The "New format" form (static markup): the four starts, the panel of each, the "Examples, not categories"
 * caption, the labelled file input, the import report and the disabled league start. Requests and navigation are
 * not run here; the request layer has its own tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { PRESETS, resolveLText } from '@/lib/format-kit/client';
import type { ImportFailure, ImportReport } from '@/lib/format-studio/editor/import-file';
import { START_KINDS, type StartKind } from '@/lib/format-studio/editor/starts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { NewFormatForm, type NewFormatData } from '../../starts/NewFormatDialog';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds } from './test-helpers';

const EXAMPLES = PRESETS.map((p) => ({ id: p.id, name: resolveLText(p.definition.identity.name, { viewer: 'en' })?.value ?? p.id }));
const DATA: NewFormatData = { examples: EXAMPLES, gallery: [], leagues: [{ id: 'l1', name: 'Spring League' }] };

function render(over: { start?: StartKind; data?: Partial<NewFormatData>; report?: ImportReport; locale?: Locale } = {}) {
  return renderWithI18n(<NewFormatForm data={{ ...DATA, ...over.data }} initialStart={over.start} initialImportReport={over.report} />, {
    locale: over.locale ?? 'en',
  });
}

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  document: {},
  issues: [],
  errorCount: 0,
  unknownFields: [],
  reserved: [],
  notes: [],
  ...over,
});

describe('NewFormatForm: the starts', () => {
  it.each(['en', 'de'] as const)('offers the four starts as one radio group, each with a label and a description (%s)', (locale) => {
    const html = render({ locale });
    const t = createTranslator(formatStudioEditorMessages, locale);
    expect([...html.matchAll(/id="fe-start-(\w+)"/g)].map((m) => m[1])).toEqual([...START_KINDS]);
    for (const kind of START_KINDS) {
      expect(html).toContain(esc(t(`new.start.${kind}`)));
      expect(html).toContain(esc(t(`new.start.${kind}Help`)));
      expect(html).toContain(`aria-describedby="fe-start-${kind}-help"`);
    }
    expect(html).toContain('<fieldset');
    expect(html).toContain('type="radio"');
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('starts on the blank start with the first radio checked', () => {
    const html = render();
    expect(/<input[^>]*id="fe-start-blank"[^>]*>/.exec(html)?.[0]).toContain('checked');
    expect(/<input[^>]*id="fe-start-import"[^>]*>/.exec(html)?.[0]).not.toContain('checked');
  });
});

describe('NewFormatForm: blank', () => {
  it('asks for a name and the language the author writes in', () => {
    const html = render();
    expect(html).toContain('for="fe-new-name"');
    expect(html).toContain('Format name');
    expect(html).toContain('for="fe-new-language"');
    expect(html).toContain('<option value="en" selected="">English</option>');
    expect(html).toContain('<option value="de">Deutsch</option>');
    expect(html).toContain('Create format');
    expect(html).not.toContain('Give the format a name.');
  });

  it('the language starts at the viewer language', () => {
    expect(render({ locale: 'de' })).toContain('<option value="de" selected="">Deutsch</option>');
  });
});

describe('NewFormatForm: example', () => {
  it.each([
    ['en', 'Examples, not categories'],
    ['de', 'Beispiele, keine Kategorien'],
  ] as const)('shows the caption in %s and lists the three shipped examples', (locale, caption) => {
    const html = render({ start: 'example', locale });
    expect(html).toContain(caption);
    for (const preset of PRESETS) expect(html).toContain(`value="preset:${preset.id}"`);
    expect(html).toContain('<optgroup');
    expect((html.match(/value="preset:/g) ?? []).length).toBe(3);
    expectLabelledControls(html);
  });

  it('leaves the gallery group out while the gallery is empty, and adds it when it has formats', () => {
    expect(render({ start: 'example' })).not.toContain('value="gallery:');
    const html = render({ start: 'example', data: { gallery: [{ id: 'g1', name: 'Autumn Cup', version: 3 }] } });
    expect(html).toContain('<optgroup label="Gallery">');
    expect(html).toContain('value="gallery:g1"');
    expect(html).toContain('Autumn Cup (version 3)');
  });

  it('the submit button says what happens', () => {
    expect(render({ start: 'example' })).toContain('Use as a starting point');
  });
});

describe('NewFormatForm: the rule preset', () => {
  it.each(['en', 'de'] as const)('is an optional, searchable, grouped pick for a blank format (%s)', (locale) => {
    const t = createTranslator(formatStudioEditorMessages, locale);
    const r = createTranslator(rulesetMessages, locale);
    const html = render({ start: 'blank', locale });
    expect(html).toContain('for="fe-new-preset"');
    expect(html).toContain(esc(t('new.presetLabel')));
    expect(html).toContain(`<option value="" selected="">${esc(t('new.presetNone'))}</option>`);
    expect(html).toContain(`<optgroup label="${esc(r('presetSelect.group', { source: r('presetSelect.source.showdown'), generation: 'Gen 9 (SV)', family: r('presetSelect.family.singles') }))}">`);
    expect(html).toContain('<option value="gen9ou">Gen 9 OU</option>');
    expect(html).toContain('type="search"');
    expect(html).toContain('for="fe-new-preset-search"');
    expect(html).toContain(esc(t('new.presetHelp')));
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('is offered for a shipped example', () => {
    const html = render({ start: 'example' });
    expect(html).toContain('for="fe-new-preset"');
    expect(html).toContain('<option value="gen9vgc">Gen 9 VGC</option>');
  });

  it('is not offered for a gallery format, a league structure or an import', () => {
    const gallery = { gallery: [{ id: 'g1', name: 'Autumn Cup', version: 3 }], examples: [] };
    // With no shipped example the first (and only) choice is a gallery format.
    expect(render({ start: 'example', data: gallery })).not.toContain('fe-new-preset');
    expect(render({ start: 'league' })).not.toContain('fe-new-preset');
    expect(render({ start: 'import' })).not.toContain('fe-new-preset');
  });
});

describe('NewFormatForm: a league', () => {
  it('lists the leagues, says the copy happens on that page, and the button opens it', () => {
    const html = render({ start: 'league' });
    expect(html).toContain('<option value="l1" selected="">Spring League</option>');
    expect(html).toContain('You copy the structure on that page.');
    expect(html).toContain("Open that league&#x27;s format");
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it('without leagues it says why and disables the button', () => {
    const html = render({ start: 'league', data: { leagues: [] } });
    expect(html).toContain('None of your leagues has phases yet');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
    expect(render({ start: 'league', data: { leagues: [] }, locale: 'de' })).toContain('Keine deiner Ligen');
  });
});

describe('NewFormatForm: import', () => {
  it('has a labelled file input that takes .json and says the file is never run', () => {
    const html = render({ start: 'import' });
    expect(html).toContain('for="fe-new-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain('never run');
    expect(html).toContain('aria-describedby="fe-new-file-help"');
    expectLabelledControls(html);
  });

  it('without a file there is no report', () => {
    const html = render({ start: 'import' });
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('Remove unknown fields');
  });

  it('reports the errors, the unknown fields and the reserved sections by pointer, with the strip option on', () => {
    const html = render({
      start: 'import',
      report: report({ errorCount: 2, unknownFields: ['/colour', '/stages/0/extra'], reserved: ['/attributes'], notes: [{ code: 'rule_kind_degraded' } as never] }),
    });
    expect(html).toContain('role="status"');
    expect(html).toContain('2 errors to fix in the editor');
    expect(html).toContain('2 fields the format does not know');
    expect(html).toContain('<code>/colour</code>');
    expect(html).toContain('<code>/stages/0/extra</code>');
    expect(html).toContain('1 section reserved for later');
    expect(html).toContain('<code>/attributes</code>');
    expect(html).toContain('1 note');
    expect(/<input[^>]*id="fe-import-strip"[^>]*>/.exec(html)?.[0]).toContain('checked');
    expect(html).toContain('Import as a private draft');
    expectLabelledControls(html);
  });

  it('lists the first twenty pointers and counts the rest', () => {
    const unknownFields = Array.from({ length: 23 }, (_, i) => `/field_${i}`);
    const html = render({ start: 'import', report: report({ unknownFields }) });
    expect(html).toContain('<code>/field_19</code>');
    expect(html).not.toContain('<code>/field_20</code>');
    expect(html).toContain('and 3 more');
  });

  it('a clean file offers no strip option', () => {
    const html = render({ start: 'import', report: report() });
    expect(html).toContain('0 errors to fix in the editor');
    expect(html).not.toContain('Remove unknown fields');
  });

  it('the report is in German for a German viewer', () => {
    const html = render({ start: 'import', locale: 'de', report: report({ unknownFields: ['/x'] }) });
    expect(html).toContain('Unbekannte Felder entfernen');
    expect(html).toContain('1 Feld, das das Format nicht kennt');
  });

  it.each(['empty', 'too_large', 'not_json', 'not_object', 'too_deep', 'too_many_nodes', 'name_required'] satisfies ImportFailure[])(
    'has a message for the failure %s in both languages',
    (reason) => {
      for (const locale of ['en', 'de'] as const) {
        const text = createTranslator(formatStudioEditorMessages, locale)(`new.failure.${reason}`);
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toContain('new.failure');
      }
    },
  );
});
