/** @vitest-environment jsdom */
/**
 * The "New format" form in a DOM: the four starts (chosen by clicking their radios), the panel of each, the "Examples, not
 * categories" caption, the labelled file input, the import report (a file is uploaded, as a viewer does) and the disabled
 * league start. Requests and navigation are not run here; the request layer has its own tests.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { PRESETS } from '@/lib/format-kit/client';
import { resolveLText } from '@/lib/studio-core/ltext';
import type { ImportFailure } from '@/lib/format-studio/editor/import-file';
import { START_KINDS, type StartKind } from '@/lib/format-studio/editor/starts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { NewFormatForm, type NewFormatData } from '../../starts/NewFormatDialog';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds } from './test-helpers';

const EXAMPLES = PRESETS.map((p) => ({ id: p.id, name: resolveLText(p.definition.identity.name, { viewer: 'en' })?.value ?? p.id }));
const DATA: NewFormatData = { examples: EXAMPLES, gallery: [], leagues: [{ id: 'l1', name: 'Spring League' }] };

/** Renders the form on its blank start and returns the user, who picks another start by clicking its radio. */
function open(over: { data?: Partial<NewFormatData>; locale?: Locale } = {}) {
  const locale = over.locale ?? 'en';
  const view = render(withI18n(<NewFormatForm data={{ ...DATA, ...over.data }} />, { locale }));
  const user = userEvent.setup();
  const t = createTranslator(formatStudioEditorMessages, locale);
  return { ...view, user, choose: (kind: StartKind) => user.click(screen.getByRole('radio', { name: t(`new.start.${kind}`) })) };
}

const byId = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`#${id}`);
const optionsOf = (select: HTMLSelectElement) => [...select.options].map((option) => option.value);

/** The kit's first shipped example as a parsed document, which the validator accepts as it is. */
const baseDocument = () => structuredClone(PRESETS[0].definition) as unknown as Record<string, unknown> & { stages: Record<string, unknown>[]; rules: unknown[] };

const jsonFile = (document: unknown, name = 'format.json') => new File([JSON.stringify(document)], name, { type: 'application/json' });

/** The file input of the import panel. */
const fileInput = (locale: Locale = 'en') => screen.getByLabelText(createTranslator(formatStudioEditorMessages, locale)('new.file'));

describe('NewFormatForm: the starts', () => {
  it.each(['en', 'de'] as const)('offers the four starts as one radio group, each with a label and a description (%s)', (locale) => {
    const { container } = open({ locale });
    const t = createTranslator(formatStudioEditorMessages, locale);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.id)).toEqual(START_KINDS.map((kind) => `fe-start-${kind}`));
    for (const kind of START_KINDS) {
      const radio = screen.getByRole('radio', { name: t(`new.start.${kind}`) });
      expect(radio.getAttribute('aria-describedby')).toBe(`fe-start-${kind}-help`);
      expect(byId(container, `fe-start-${kind}-help`)?.textContent).toBe(t(`new.start.${kind}Help`));
    }
    expect(screen.getByRole('group', { name: t('new.startLegend') })).toBeTruthy();
    expectLabelledControls(container.innerHTML);
    expectNoLeftovers(container.innerHTML);
    expectUniqueIds(container.innerHTML);
  });

  it('starts on the blank start with the first radio checked, and clicking another radio moves the choice', async () => {
    const { choose } = open();
    const checked = () => (screen.getAllByRole('radio') as HTMLInputElement[]).filter((radio) => radio.checked).map((radio) => radio.id);
    expect(checked()).toEqual(['fe-start-blank']);
    await choose('import');
    expect(checked()).toEqual(['fe-start-import']);
  });
});

describe('NewFormatForm: blank', () => {
  it('asks for a name and the language the author writes in', () => {
    const { container } = open();
    expect(container.querySelector('label[for="fe-new-name"]')?.textContent).toBe('Format name');
    expect(container.querySelector('label[for="fe-new-language"]')).not.toBeNull();
    const language = byId(container, 'fe-new-language') as HTMLSelectElement;
    expect([...language.options].map((option) => [option.value, option.text, option.selected])).toEqual([
      ['en', 'English', true],
      ['de', 'Deutsch', false],
    ]);
    expect(screen.getByRole('button', { name: 'Create format' })).toBeTruthy();
    expect(screen.queryByText('Give the format a name.')).toBeNull();
  });

  it('the language starts at the viewer language', () => {
    const { container } = open({ locale: 'de' });
    expect((byId(container, 'fe-new-language') as HTMLSelectElement).value).toBe('de');
  });
});

describe('NewFormatForm: example', () => {
  it.each([
    ['en', 'Examples, not categories'],
    ['de', 'Beispiele, keine Kategorien'],
  ] as const)('shows the caption in %s and lists the three shipped examples', async (locale, caption) => {
    const { container, choose } = open({ locale });
    await choose('example');
    expect(screen.getByText(caption)).toBeTruthy();
    const select = byId(container, 'fe-new-example') as HTMLSelectElement;
    expect(optionsOf(select)).toEqual(PRESETS.map((preset) => `preset:${preset.id}`));
    expect(select.querySelectorAll('optgroup')).toHaveLength(1);
    expect(select.options).toHaveLength(3);
    expectLabelledControls(container.innerHTML);
  });

  it('leaves the gallery group out while the gallery is empty, and adds it when it has formats', async () => {
    const empty = open();
    await empty.choose('example');
    expect(optionsOf(byId(empty.container, 'fe-new-example') as HTMLSelectElement).some((value) => value.startsWith('gallery:'))).toBe(false);
    empty.unmount();

    const { container, choose } = open({ data: { gallery: [{ id: 'g1', name: 'Autumn Cup', version: 3 }] } });
    await choose('example');
    const select = byId(container, 'fe-new-example') as HTMLSelectElement;
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['Shipped examples', 'Gallery']);
    const option = [...select.options].find((candidate) => candidate.value === 'gallery:g1');
    expect(option?.text).toBe('Autumn Cup (version 3)');
  });

  it('the submit button says what happens', async () => {
    const { choose } = open();
    await choose('example');
    expect(screen.getByRole('button', { name: 'Use as a starting point' })).toBeTruthy();
  });
});

describe('NewFormatForm: the rule preset', () => {
  it.each(['en', 'de'] as const)('is an optional, searchable, grouped pick for a blank format (%s)', (locale) => {
    const t = createTranslator(formatStudioEditorMessages, locale);
    const r = createTranslator(rulesetMessages, locale);
    const { container } = open({ locale });
    const select = byId(container, 'fe-new-preset') as HTMLSelectElement;
    expect(container.querySelector('label[for="fe-new-preset"]')?.textContent).toBe(t('new.presetLabel'));
    expect(select.selectedOptions[0].value).toBe('');
    expect(select.selectedOptions[0].text).toBe(t('new.presetNone'));
    const group = r('presetSelect.group', { source: r('presetSelect.source.showdown'), generation: 'Gen 9 (SV)', family: r('presetSelect.family.singles') });
    expect([...select.querySelectorAll('optgroup')].map((candidate) => candidate.label)).toContain(group);
    expect([...select.options].find((option) => option.value === 'gen9ou')?.text).toBe('Gen 9 OU');
    expect((byId(container, 'fe-new-preset-search') as HTMLInputElement).type).toBe('search');
    expect(container.querySelector('label[for="fe-new-preset-search"]')).not.toBeNull();
    expect(byId(container, 'fe-new-preset-help')?.textContent).toBe(t('new.presetHelp'));
    expectLabelledControls(container.innerHTML);
    expectNoLeftovers(container.innerHTML);
    expectUniqueIds(container.innerHTML);
  });

  it('is offered for a shipped example', async () => {
    const { container, choose } = open();
    await choose('example');
    const select = byId(container, 'fe-new-preset') as HTMLSelectElement;
    expect(container.querySelector('label[for="fe-new-preset"]')).not.toBeNull();
    expect([...select.options].find((option) => option.value === 'gen9vgc')?.text).toBe('Gen 9 VGC');
  });

  it('is not offered for a gallery format, a league structure or an import', async () => {
    const gallery = { gallery: [{ id: 'g1', name: 'Autumn Cup', version: 3 }], examples: [] };
    // With no shipped example the first (and only) choice is a gallery format.
    const withGallery = open({ data: gallery });
    await withGallery.choose('example');
    expect(byId(withGallery.container, 'fe-new-preset')).toBeNull();
    withGallery.unmount();

    const { container, choose } = open();
    await choose('league');
    expect(byId(container, 'fe-new-preset')).toBeNull();
    await choose('import');
    expect(byId(container, 'fe-new-preset')).toBeNull();
  });
});

describe('NewFormatForm: a league', () => {
  it('lists the leagues, says the copy happens on that page, and the button opens it', async () => {
    const { container, choose } = open();
    await choose('league');
    const select = byId(container, 'fe-new-league') as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.text, option.selected])).toEqual([['l1', 'Spring League', true]]);
    expect(screen.getByText('You copy the structure on that page.')).toBeTruthy();
    const button = screen.getByRole('button', { name: "Open that league's format" }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.disabled).toBe(false);
  });

  it('without leagues it says why and disables the button', async () => {
    const { choose } = open({ data: { leagues: [] } });
    await choose('league');
    expect(screen.getByText(/None of your leagues has phases yet/)).toBeTruthy();
    const button = screen.getByRole('button', { name: "Open that league's format" }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.disabled).toBe(true);
  });

  it('says it in German too', async () => {
    const { choose } = open({ data: { leagues: [] }, locale: 'de' });
    await choose('league');
    expect(screen.getByText(/^Keine deiner Ligen/)).toBeTruthy();
  });
});

describe('NewFormatForm: import', () => {
  it('has a labelled file input that takes .json and says the file is never run', async () => {
    const { container, choose } = open();
    await choose('import');
    const input = fileInput() as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.getAttribute('accept')).toBe('application/json,.json');
    expect(input.getAttribute('aria-describedby')).toBe('fe-new-file-help');
    expect(byId(container, 'fe-new-file-help')?.textContent).toContain('never run');
    expectLabelledControls(container.innerHTML);
  });

  it('without a file there is no report', async () => {
    const { choose } = open();
    await choose('import');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Remove unknown fields')).toBeNull();
  });

  it('reports the errors, the unknown fields and the reserved sections by pointer, with the strip option on', async () => {
    const { container, user, choose } = open();
    await choose('import');
    const document = baseDocument();
    // Two unknown members, one reserved section and two schema errors.
    const messy = {
      ...document,
      colour: 'red',
      attributes: {},
      modules: 5,
      edges: 'x',
      stages: document.stages.map((stage, index) => (index === 0 ? { ...stage, extra: 1 } : stage)),
    };
    await user.upload(fileInput(), jsonFile(messy));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('2 errors to fix in the editor')).toBeTruthy();
    expect(within(status).getByText('2 fields the format does not know')).toBeTruthy();
    expect(within(status).getByText('/colour')).toBeTruthy();
    expect(within(status).getByText('/stages/0/extra')).toBeTruthy();
    expect(within(status).getByText('1 section reserved for later')).toBeTruthy();
    expect(within(status).getByText('/attributes')).toBeTruthy();
    expect(within(status).queryByText(/note/)).toBeNull();
    expect((within(status).getByLabelText('Remove unknown fields') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Import as a private draft' })).toBeTruthy();
    expectLabelledControls(container.innerHTML);
  });

  it('notes a rule kind the editor does not know, which it keeps as a manual rule', async () => {
    const { user, choose } = open();
    await choose('import');
    const document = baseDocument();
    await user.upload(fileInput(), jsonFile({ ...document, rules: [...document.rules, { kind: 'rule.future_thing', id: 'future' }] }));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('0 errors to fix in the editor')).toBeTruthy();
    expect(within(status).getByText('1 note')).toBeTruthy();
  });

  it('the strip option can be turned off', async () => {
    const { user, choose } = open();
    await choose('import');
    await user.upload(fileInput(), jsonFile({ ...baseDocument(), colour: 'red' }));
    const strip = (await screen.findByLabelText('Remove unknown fields')) as HTMLInputElement;
    expect(strip.checked).toBe(true);
    await user.click(strip);
    expect(strip.checked).toBe(false);
  });

  it('lists the first twenty pointers and counts the rest', async () => {
    const { user, choose } = open();
    await choose('import');
    const fields = Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`field_${i}`, i]));
    await user.upload(fileInput(), jsonFile({ ...baseDocument(), ...fields }));
    const status = await screen.findByRole('status');
    expect(within(status).getAllByText(/^\/field_\d+$/)).toHaveLength(20);
    expect(within(status).getByText('and 3 more')).toBeTruthy();
  });

  it('a clean file offers no strip option', async () => {
    const { user, choose } = open();
    await choose('import');
    await user.upload(fileInput(), jsonFile(baseDocument()));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('0 errors to fix in the editor')).toBeTruthy();
    expect(screen.queryByLabelText('Remove unknown fields')).toBeNull();
  });

  it('the report is in German for a German viewer', async () => {
    const { user, choose } = open({ locale: 'de' });
    await choose('import');
    await user.upload(fileInput('de'), jsonFile({ ...baseDocument(), x: 1 }));
    const status = await screen.findByRole('status');
    expect(within(status).getByLabelText('Unbekannte Felder entfernen')).toBeTruthy();
    expect(within(status).getByText('1 Feld, das das Format nicht kennt')).toBeTruthy();
  });

  it('names the problem of a file that is not JSON, and drops an earlier report', async () => {
    const { user, choose } = open();
    await choose('import');
    await user.upload(fileInput(), jsonFile(baseDocument()));
    await screen.findByRole('status');
    await user.upload(fileInput(), new File(['{ nope'], 'broken.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByText('The file is not valid JSON.')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
    expect(fileInput().getAttribute('aria-invalid')).toBe('true');
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
