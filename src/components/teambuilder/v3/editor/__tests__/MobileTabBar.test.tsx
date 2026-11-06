/** @vitest-environment jsdom */
/**
 * The mobile tab bar's buttons open modal sheets: they announce that (aria-haspopup="dialog", aria-expanded), and
 * closing a sheet hands focus back to the tab that opened it. The validation sheet is the only place below `lg` that
 * lists the verdict (the right column is hidden there), so a "saved, rules not met" chip has somewhere to point.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { TeamValidationResult } from '@/types/team';

vi.mock('../../intel/IntelPanel', () => ({ default: () => <p>Intel body</p> }));
vi.mock('../../ai/AiPanel', () => ({ default: () => <p>Ai body</p> }));

import MobileTabBar from '../MobileTabBar';

const VERDICT: TeamValidationResult = {
  valid: false,
  issues: [{ pokemon_index: 0, species: 'Pikachu', issue_id: 'i1', issue: 'Light Ball is banned', severity: 'error' } as never],
  team_issues: ['Team size must be 4'],
};

describe('MobileTabBar', () => {
  it('marks every tab as a dialog opener', () => {
    render(withI18n(<MobileTabBar validation={null} />));
    const tabs = screen.getAllByRole('button');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-haspopup')).toBe('dialog');
      expect(tab.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('opens a labelled sheet, reports it expanded, and returns focus to the tab on close', async () => {
    const user = userEvent.setup();
    render(withI18n(<MobileTabBar validation={null} />));
    const [intelTab] = screen.getAllByRole('button');
    await user.click(intelTab);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull();
    expect(screen.getByText('Intel body')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(intelTab));
  });

  it('lists the team-level issues of the verdict in a validation sheet', async () => {
    const user = userEvent.setup();
    render(withI18n(<MobileTabBar validation={VERDICT} />));
    await user.click(screen.getByRole('button', { name: 'Validate' }));
    const dialog = screen.getByRole('dialog', { name: 'Validation' });
    expect(within(dialog).getByText('Team size must be 4')).toBeTruthy();
    expect(within(dialog).getByText('Light Ball is banned')).toBeTruthy();
  });

  it('closes the validation sheet and reports the issue when one is tapped', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(withI18n(<MobileTabBar validation={VERDICT} onJumpToIssue={onJump} />));
    await user.click(screen.getByRole('button', { name: 'Validate' }));
    await user.click(screen.getByRole('button', { name: 'Light Ball is banned' }));
    expect(onJump).toHaveBeenCalledWith('i1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
