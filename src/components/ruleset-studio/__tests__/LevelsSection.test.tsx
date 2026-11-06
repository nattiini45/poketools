/** @vitest-environment jsdom */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import LevelsSection from '../sections/LevelsSection';

function Harness() {
  const [doc, setDoc] = useState<RulesetDocument>(() => newRulesetDocument('Levels', 'en'));
  return <LevelsSection doc={doc} onChange={setDoc} />;
}

describe('LevelsSection', () => {
  it('configures policy, default and per-species approval through the real controls', async () => {
    const user = userEvent.setup();
    render(withI18n(<Harness />));
    await user.click(screen.getByRole('button', { name: 'Configure level rules' }));
    await user.selectOptions(screen.getByLabelText('Level policy'), 'exact');
    const defaultLevel = screen.getByLabelText('Default level');
    await user.click(defaultLevel);
    await user.keyboard('{Control>}a{/Control}95');
    await user.click(screen.getByRole('button', { name: 'Add species level' }));
    await user.type(screen.getByLabelText('Pokémon ID'), 'Dialga!');
    const level = screen.getByLabelText('Level');
    await user.click(level);
    await user.keyboard('{Control>}a{/Control}90');
    await user.selectOptions(screen.getByLabelText('Status'), 'approved');
    expect(screen.getByLabelText('Pokémon ID')).toHaveProperty('value', 'dialga');
    expect(level).toHaveProperty('value', '90');
    expect(defaultLevel).toHaveProperty('value', '95');
    expect(screen.getByLabelText('Status')).toHaveProperty('value', 'approved');
    await user.click(screen.getByRole('button', { name: 'Remove level rules' }));
    expect(screen.getByRole('button', { name: 'Configure level rules' })).toBeTruthy();
  });
});
