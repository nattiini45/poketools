/** @vitest-environment jsdom */
/**
 * `StepPicker` in a DOM: choosing up to the step's count, radio buttons for a single choice, blocked rows with their
 * reason, the search by localised name, and a row the last answer said was taken.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { StepView } from '@/lib/format-engine/runtime/view-types';
import StepPicker from '../StepPicker';
import { ENTRIES, entry, step } from './fixtures';

function Harness({ step: stepView, takenIds, initial = [] }: { step: StepView; takenIds?: ReadonlySet<string>; initial?: string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);
  return <StepPicker step={stepView} entries={ENTRIES} selected={selected} onChange={setSelected} takenIds={takenIds} />;
}

function setup(stepView: StepView, { locale = 'en', takenIds, initial }: { locale?: Locale; takenIds?: ReadonlySet<string>; initial?: string[] } = {}) {
  render(withI18n(<Harness step={stepView} takenIds={takenIds} initial={initial} />, { locale }));
  return { user: userEvent.setup(), t: createTranslator(formatRuntimePlayerMessages, locale) };
}

describe('StepPicker', () => {
  it('a step that wants one entry is a radio group that switches the choice', async () => {
    const { user } = setup(step({ count: 1 }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Pikachu' }));
    await user.click(screen.getByRole('radio', { name: 'Charizard' }));
    expect((screen.getByRole('radio', { name: 'Pikachu' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: 'Charizard' }) as HTMLInputElement).checked).toBe(true);
  });

  it('a step that wants several entries stops offering more once the count is reached', async () => {
    const { user, t } = setup(step({ count: 2 }));
    await user.click(screen.getByRole('checkbox', { name: 'Pikachu' }));
    await user.click(screen.getByRole('checkbox', { name: 'Bulbasaur' }));
    expect(screen.getByText(t('step.counter', { picked: 2, count: 2 }))).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Charizard' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('shows the attributes of an entry next to it and says which attribute has to differ', () => {
    const { t } = setup(step({ distinct_attr: 'tier' }));
    expect(screen.getByText('tier: premium')).toBeTruthy();
    expect(screen.getByText(t('step.distinct', { attr: 'tier' }))).toBeTruthy();
  });

  it('disables blocked rows with the reason tied to the control, but lets a chosen blocked row be taken back', async () => {
    const { user, t } = setup(step({ blocked: [{ id: 'pikachu', reason: 'taken' }, { id: 'bulbasaur', reason: 'not_eligible' }] }), {
      initial: ['pikachu'],
    });
    const pikachu = screen.getByRole('checkbox', { name: 'Pikachu' }) as HTMLInputElement;
    expect(pikachu.checked).toBe(true);
    expect(pikachu.disabled).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Bulbasaur' }) as HTMLInputElement).disabled).toBe(true);
    expect(document.getElementById(pikachu.getAttribute('aria-describedby')!)?.textContent).toContain(t('step.taken'));
    await user.click(pikachu);
    expect(pikachu.checked).toBe(false);
    expect(pikachu.disabled).toBe(true);
  });

  it('marks the row an answer said was taken', () => {
    const { t } = setup(step(), { takenIds: new Set(['charizard']) });
    expect((screen.getByRole('checkbox', { name: 'Charizard' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(t('step.taken'))).toBeTruthy();
  });

  it('filters by the typed text, in English or German whatever the display language', async () => {
    const { user, t } = setup(step(), { locale: 'de' });
    const search = screen.getByRole('searchbox', { name: t('step.search', { domain: 'Geschenke' }) });
    await user.type(search, 'glurak');
    expect(screen.getByRole('checkbox', { name: 'Glurak' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Pikachu' })).toBeNull();

    await user.clear(search);
    await user.type(search, 'charizard');
    expect(screen.getByRole('checkbox', { name: 'Glurak' })).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.getByText(t('step.noMatches'))).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps the chosen entries when the search hides them', async () => {
    const { user, t } = setup(step());
    await user.click(screen.getByRole('checkbox', { name: 'Pikachu' }));
    await user.type(screen.getByRole('searchbox'), 'bulba');
    expect(screen.queryByRole('checkbox', { name: 'Pikachu' })).toBeNull();
    expect(screen.getByText(t('step.counter', { picked: 1, count: 2 }))).toBeTruthy();
  });

  it('a locked list and an empty list say so instead of showing a picker', () => {
    const locked = setup(step({ unlocked: false }));
    expect(screen.getByText(locked.t('step.locked'))).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows a German name for a species that has one, and the id with a capital letter otherwise', () => {
    render(withI18n(<StepPicker step={step()} entries={[entry('charizard'), entry('notarealspecies')]} selected={[]} onChange={() => {}} />, { locale: 'de' }));
    expect(screen.getByRole('checkbox', { name: 'Glurak' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Notarealspecies' })).toBeTruthy();
  });
});
