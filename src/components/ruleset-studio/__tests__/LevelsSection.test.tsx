/** @vitest-environment jsdom */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { MAX_LEVEL_ENTRIES } from '@/lib/ruleset-kit/limits';
import { validateRulesetDocument } from '@/lib/ruleset-kit/validate';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import LevelsSection from '../sections/LevelsSection';

let latest: RulesetDocument = newRulesetDocument('Levels', 'en');

function Harness({ initial }: { initial?: RulesetDocument }) {
  const [doc, setDoc] = useState<RulesetDocument>(() => initial ?? newRulesetDocument('Levels', 'en'));
  // The latest document is recorded in the change handler, not during render.
  const change = (next: RulesetDocument) => {
    latest = next;
    setDoc(next);
  };
  return <LevelsSection doc={doc} onChange={change} />;
}

const withLevels = (entries: NonNullable<RulesetDocument['levels']>['entries'] = []): RulesetDocument => ({
  ...newRulesetDocument('Levels', 'en'),
  levels: { policy: 'max', default: 100, entries },
});

// Real keystrokes through user-event: slow on a loaded machine, and a timed-out test would keep typing into the next one.
const TIMEOUT = 30_000;

describe('LevelsSection', () => {
  it('configures policy, default and per-species approval through the real controls', async () => {
    const user = userEvent.setup();
    render(withI18n(<Harness />));
    await user.click(screen.getByRole('button', { name: 'Configure level rules' }));
    await user.selectOptions(screen.getByLabelText('Level policy'), 'exact');
    const defaultLevel = screen.getByLabelText('Default level');
    await user.click(defaultLevel);
    await user.keyboard('{Control>}a{/Control}95');
    await user.type(screen.getByLabelText('Species to add (Pokémon ID)'), 'Dialga!');
    await user.click(screen.getByRole('button', { name: 'Add species level' }));
    const level = screen.getByLabelText('Level');
    await user.click(level);
    await user.keyboard('{Control>}a{/Control}90');
    await user.selectOptions(screen.getByLabelText('Status'), 'approved');
    expect(screen.getByLabelText('Pokémon ID')).toHaveProperty('value', 'dialga');
    expect(level).toHaveProperty('value', '90');
    expect(defaultLevel).toHaveProperty('value', '95');
    expect(screen.getByLabelText('Status')).toHaveProperty('value', 'approved');
    expect(latest.levels).toEqual({ policy: 'exact', default: 95, entries: [{ id: 'dialga', level: 90, status: 'approved' }] });
    await user.click(screen.getByRole('button', { name: 'Remove level rules' }));
    expect(screen.getByRole('button', { name: 'Configure level rules' })).toBeTruthy();
  }, TIMEOUT);

  it('lets a number be cleared and retyped: an empty field is not written as level 1', async () => {
    const user = userEvent.setup();
    render(withI18n(<Harness initial={withLevels()} />));
    const defaultLevel = screen.getByLabelText('Default level');
    await user.click(defaultLevel);
    await user.keyboard('{Backspace}{Backspace}{Backspace}');
    expect(defaultLevel).toHaveProperty('value', '');
    expect(latest.levels?.default).toBe(1); // the last accepted value while typing (100, 10, 1), never 0 or empty
    await user.keyboard('5');
    expect(defaultLevel).toHaveProperty('value', '5');
    expect(latest.levels?.default).toBe(5);
    await user.keyboard('0');
    expect(latest.levels?.default).toBe(50);
  }, TIMEOUT);

  it('settles an empty or out-of-range number on blur', async () => {
    const user = userEvent.setup();
    render(withI18n(<Harness initial={withLevels()} />));
    const defaultLevel = screen.getByLabelText('Default level');
    await user.click(defaultLevel);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await user.tab();
    expect(defaultLevel).toHaveProperty('value', '100');
    await user.click(defaultLevel);
    await user.keyboard('{Control>}a{/Control}999');
    await user.tab();
    expect(latest.levels?.default).toBe(100);
    await user.click(defaultLevel);
    await user.keyboard('{Control>}a{/Control}0');
    await user.tab();
    expect(latest.levels?.default).toBe(1);
  }, TIMEOUT);

  it('stops adding at the same entry cap the validator enforces', async () => {
    const user = userEvent.setup();
    const full = withLevels(Array.from({ length: MAX_LEVEL_ENTRIES }, (_, i) => ({ id: `mon${i}`, level: 50, status: 'approved' as const })));
    latest = full;
    render(withI18n(<Harness initial={full} />));
    await user.type(screen.getByLabelText('Species to add (Pokémon ID)'), 'Palkia');
    expect(screen.getByRole('button', { name: 'Add species level' })).toHaveProperty('disabled', true);
    expect(validateRulesetDocument(latest).ok).toBe(true);
    // The disabled button is not the only signal: the field says why nothing more can be added.
    expect(screen.getByText(`At most ${MAX_LEVEL_ENTRIES} species can have their own level.`)).toBeTruthy();
  }, TIMEOUT);

  it('gives no cap hint while there is room', () => {
    render(withI18n(<Harness initial={withLevels([{ id: 'dialga', level: 50, status: 'approved' }])} />));
    expect(screen.queryByText(/At most/)).toBeNull();
  });

  it('names each Remove button after its species, so a list of them can be told apart', () => {
    render(
      withI18n(
        <Harness
          initial={withLevels([
            { id: 'dialga', level: 50, status: 'approved' },
            { id: 'palkia', level: 60, status: 'experimental' },
          ])}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Remove level rule for dialga' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove level rule for palkia' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('names them in German', () => {
    render(withI18n(<Harness initial={withLevels([{ id: 'dialga', level: 50, status: 'approved' }])} />, { locale: 'de' }));
    expect(screen.getByRole('button', { name: 'Level-Regel für dialga entfernen' })).toBeTruthy();
  });

  it('moves focus to the next entry after a Remove, then to the previous one, then to the add field', async () => {
    const user = userEvent.setup();
    render(
      withI18n(
        <Harness
          initial={withLevels([
            { id: 'dialga', level: 50, status: 'approved' },
            { id: 'palkia', level: 60, status: 'approved' },
          ])}
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Remove level rule for dialga' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Pokémon ID'));
    expect(screen.getByLabelText('Pokémon ID')).toHaveProperty('value', 'palkia');
    await user.click(screen.getByRole('button', { name: 'Remove level rule for palkia' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Species to add (Pokémon ID)'));
  }, TIMEOUT);

  it('moves focus to the previous entry when the last one is removed', async () => {
    const user = userEvent.setup();
    render(
      withI18n(
        <Harness
          initial={withLevels([
            { id: 'dialga', level: 50, status: 'approved' },
            { id: 'palkia', level: 60, status: 'approved' },
          ])}
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Remove level rule for palkia' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Pokémon ID'));
    expect(screen.getByLabelText('Pokémon ID')).toHaveProperty('value', 'dialga');
  }, TIMEOUT);

  it('moves focus to the enable button after the level rules are removed', async () => {
    const user = userEvent.setup();
    render(withI18n(<Harness initial={withLevels()} />));
    await user.click(screen.getByRole('button', { name: 'Remove level rules' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Configure level rules' }));
  }, TIMEOUT);

  it('moves focus to the policy select after the level rules are enabled', async () => {
    const user = userEvent.setup();
    render(withI18n(<Harness />));
    await user.click(screen.getByRole('button', { name: 'Configure level rules' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Level policy'));
  }, TIMEOUT);

  it('never writes an entry without a species id, so the document stays valid and its other diagnostics stay visible', async () => {
    const user = userEvent.setup();
    const initial = withLevels([{ id: 'dialga', level: 90, status: 'approved' }]);
    latest = initial;
    render(withI18n(<Harness initial={initial} />));
    const add = screen.getByRole('button', { name: 'Add species level' });
    expect(add).toHaveProperty('disabled', true);
    expect(latest.levels?.entries).toHaveLength(1);

    // Clearing the id of an existing entry keeps the committed id until a new one is typed.
    const id = screen.getByLabelText('Pokémon ID');
    await user.click(id);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    expect(latest.levels?.entries[0].id).toBe('dialga');
    expect(validateRulesetDocument(latest).ok).toBe(true);
    await user.tab();
    expect(id).toHaveProperty('value', 'dialga');

    // Adding needs an id, and Enter in the field adds it.
    await user.type(screen.getByLabelText('Species to add (Pokémon ID)'), 'Palkia{Enter}');
    expect(latest.levels?.entries.map((entry) => entry.id)).toEqual(['dialga', 'palkia']);
    expect(validateRulesetDocument(latest).ok).toBe(true);
    expect(screen.getByLabelText('Species to add (Pokémon ID)')).toHaveProperty('value', '');
  }, TIMEOUT);
});
