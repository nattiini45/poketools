/** @vitest-environment jsdom */
/**
 * The "New ruleset" form in a DOM: the four starts (chosen by clicking their radios), the panel of each, the Smogon tour
 * toggle (offered for the draft presets, enabled only where the catalog has documented extras), the labelled file input
 * and the import report (a file is uploaded, as a viewer does). Requests and navigation are not run here; the request
 * layer has its own tests.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { START_KINDS, type StartKind } from '@/lib/ruleset-studio/editor/starts';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { NewRulesetForm, type NewRulesetData } from '../starts/NewRulesetDialog';

const DATA: NewRulesetData = { shared: [{ id: 'r1', name: 'Core Liga OU', version: 3 }] };

/** Renders the form on its blank start and returns the user, who picks another start by clicking its radio. */
function open(over: { data?: Partial<NewRulesetData>; locale?: Locale } = {}) {
  const view = render(withI18n(<NewRulesetForm data={{ ...DATA, ...over.data }} />, { locale: over.locale ?? 'en' }));
  const user = userEvent.setup();
  const t = createTranslator(rulesetStudioMessages, over.locale ?? 'en');
  return { ...view, user, choose: (kind: StartKind) => user.click(screen.getByRole('radio', { name: t(`new.start.${kind}`) })) };
}

const select = (label: string | RegExp) => screen.getByLabelText(label) as HTMLSelectElement;
const optionsOf = (element: HTMLSelectElement) => [...element.options].map((option) => ({ value: option.value, text: option.text, selected: option.selected }));

/** A ruleset document file with `count` malformed Pokémon ids, which the structure validator reports one by one. */
function fileWithProblems(count: number): File {
  const document = { ...newRulesetDocument('Spring OU', 'en', 'gen9ou'), pokemon: { ban: Array.from({ length: count }, () => 'Not An Id'), unban: [], allow: null } };
  return new File([JSON.stringify(document)], 'ruleset.json', { type: 'application/json' });
}

describe('NewRulesetForm: the starts', () => {
  it.each(['en', 'de'] as const)('offers the four starts as one radio group, each with a label and a description (%s)', (locale) => {
    const { container } = open({ locale });
    const t = createTranslator(rulesetStudioMessages, locale);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.id)).toEqual(START_KINDS.map((kind) => `re-start-${kind}`));
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(['re-start']));
    for (const kind of START_KINDS) {
      const radio = screen.getByRole('radio', { name: t(`new.start.${kind}`) });
      expect(radio.getAttribute('aria-describedby')).toBe(`re-start-${kind}-help`);
      expect(container.querySelector(`#re-start-${kind}-help`)?.textContent).toBe(t(`new.start.${kind}Help`));
    }
    expect(screen.getByRole('group', { name: t('new.startLegend') })).toBeTruthy();
    expectLabelledControls(container.innerHTML);
    expectNoLeftovers(container.innerHTML);
    expectUniqueIds(container.innerHTML);
  });

  it('starts on the blank start, and clicking another radio moves the choice', async () => {
    const { choose } = open();
    const checked = () => (screen.getAllByRole('radio') as HTMLInputElement[]).filter((radio) => radio.checked).map((radio) => radio.id);
    expect(checked()).toEqual(['re-start-blank']);
    await choose('preset');
    expect(checked()).toEqual(['re-start-preset']);
  });
});

describe('NewRulesetForm: blank', () => {
  it('asks for a name and the language, and has no preset picker', () => {
    const { container } = open();
    expect(container.querySelector('label[for="re-new-name"]')?.textContent).toBe('Ruleset name');
    expect(optionsOf(select('Language you write in'))).toEqual([
      { value: 'en', text: 'English', selected: true },
      { value: 'de', text: 'Deutsch', selected: false },
    ]);
    expect(screen.getByRole('button', { name: 'Create ruleset' })).toBeTruthy();
    expect(container.querySelector('#re-new-preset')).toBeNull();
    expect(container.querySelector('#re-new-tour')).toBeNull();
  });

  it('the language starts at the viewer language', () => {
    open({ locale: 'de' });
    expect(select('Sprache, in der du schreibst').value).toBe('de');
  });
});

describe('NewRulesetForm: from a rule preset', () => {
  it('shows the preset picker with Gen 9 OU chosen, and the name as optional', async () => {
    const { container, choose } = open();
    await choose('preset');
    const picker = container.querySelector<HTMLSelectElement>('#re-new-preset');
    expect(picker).not.toBeNull();
    expect(optionsOf(picker!).filter((option) => option.selected)).toEqual([{ value: 'gen9ou', text: 'Gen 9 OU', selected: true }]);
    expect(container.querySelector('label[for="re-new-name"]')?.textContent).toBe('Ruleset name (optional)');
    expect(screen.getByText('Leave it empty to use the preset’s own name.')).toBeTruthy();
    expect(container.querySelector('#re-new-preset-help')).not.toBeNull();
    expectLabelledControls(container.innerHTML);
    expectUniqueIds(container.innerHTML);
    expectNoLeftovers(container.innerHTML);
  });

  it('does not show the Smogon tour toggle for a Showdown ladder preset', async () => {
    const { container, choose } = open();
    await choose('preset');
    expect(container.querySelector('#re-new-tour')).toBeNull();
    expect(screen.queryByText('Add Smogon tour bans')).toBeNull();
  });

  it('shows the toggle, enabled and unchecked, for a draft preset with documented extras', async () => {
    const { container, user, choose } = open();
    await choose('preset');
    await user.selectOptions(container.querySelector<HTMLSelectElement>('#re-new-preset')!, 'gen9natdexdraft');
    const box = screen.getByRole('checkbox', { name: 'Add Smogon tour bans' }) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
    expect(box.getAttribute('aria-describedby')).toBe('re-new-tour-help');
    expect(container.querySelector('#re-new-tour-help')?.textContent).toContain('as ordinary entries');
    expectLabelledControls(container.innerHTML);
    await user.click(box);
    expect(box.checked).toBe(true);
  });

  it('shows the toggle disabled, with the reason, for a draft preset without documented extras', async () => {
    const { container, user, choose } = open();
    await choose('preset');
    await user.selectOptions(container.querySelector<HTMLSelectElement>('#re-new-preset')!, 'gen9draft');
    const box = screen.getByRole('checkbox', { name: 'Add Smogon tour bans' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByText('This preset has no documented Smogon tour extras.')).toBeTruthy();
  });

  it.each(['en', 'de'] as const)('says the toggle in the viewer language (%s)', async (locale) => {
    const { container, user, choose } = open({ locale });
    await choose('preset');
    await user.selectOptions(container.querySelector<HTMLSelectElement>('#re-new-preset')!, 'gen9natdexdraft');
    expect(container.querySelector('label[for="re-new-tour"]')?.textContent).toBe(createTranslator(rulesetStudioMessages, locale)('new.tourOverlay'));
  });
});

describe('NewRulesetForm: from a shared ruleset', () => {
  it('lists the shared rulesets with their version', async () => {
    const { container, choose } = open();
    await choose('fork');
    expect(container.querySelector('label[for="re-new-fork"]')).not.toBeNull();
    expect(optionsOf(select('Ruleset to copy'))).toEqual([{ value: 'r1', text: 'Core Liga OU (version 3)', selected: true }]);
    expect(screen.getByText('A copy takes the last published version into a private draft.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy ruleset' })).toBeTruthy();
    expectLabelledControls(container.innerHTML);
  });

  it('says there is nothing to copy and disables the button when nothing is shared', async () => {
    const { container, choose } = open({ data: { shared: [] } });
    await choose('fork');
    expect(screen.getByText('Nobody has shared a ruleset with you yet, so there is nothing to copy.')).toBeTruthy();
    expect(container.querySelector('#re-new-fork')).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy ruleset' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('NewRulesetForm: import', () => {
  it('has a labelled file input restricted to JSON, with the help text', async () => {
    const { choose } = open();
    await choose('import');
    const input = screen.getByLabelText('Ruleset file (.json)') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.getAttribute('accept')).toBe('application/json,.json');
    expect(input.getAttribute('aria-describedby')).toBe('re-new-file-help');
    expect(screen.getByText(/It is never run\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import as a private draft' })).toBeTruthy();
  });

  it('reports a valid document in one line', async () => {
    const { user, choose } = open();
    await choose('import');
    const valid = new File([JSON.stringify(newRulesetDocument('Spring OU', 'en', 'gen9ou'))], 'ruleset.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Ruleset file (.json)'), valid);
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('The file is a valid ruleset document.');
  });

  it('lists the first twenty problems with their path and code, then how many more', async () => {
    const { container, user, choose } = open();
    await choose('import');
    await user.upload(screen.getByLabelText('Ruleset file (.json)'), fileWithProblems(23));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('23 problems in the file')).toBeTruthy();
    const paths = within(status).getAllByText(/^\/pokemon\/ban\/\d+$/).map((code) => code.textContent);
    expect(paths).toEqual(Array.from({ length: 20 }, (_, i) => `/pokemon/ban/${i}`));
    expect(within(status).getAllByText('bad_id')).toHaveLength(20);
    expect(within(status).getByText('and 3 more')).toBeTruthy();
    expect(status.querySelector('ul')?.getAttribute('aria-labelledby')).toBe('re-import-issues');
    expectUniqueIds(container.innerHTML);
  });

  it('shows no report before a file is chosen', async () => {
    const { choose } = open();
    await choose('import');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names the problem of a file that is not JSON, and drops an earlier report', async () => {
    const { user, choose } = open();
    await choose('import');
    const input = screen.getByLabelText('Ruleset file (.json)');
    await user.upload(input, fileWithProblems(2));
    await screen.findByRole('status');
    await user.upload(input, new File(['{ nope'], 'broken.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByText('The file is not valid JSON.')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
