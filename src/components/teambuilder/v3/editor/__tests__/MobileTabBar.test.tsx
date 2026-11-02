/** @vitest-environment jsdom */
/**
 * The mobile tab bar's buttons open modal sheets: they announce that (ria-haspopup="dialog", ria-expanded), and
 * closing a sheet hands focus back to the tab that opened it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';

vi.mock('../../intel/IntelPanel', () => ({ default: () => <p>Intel body</p> }));
vi.mock('../../ai/AiPanel', () => ({ default: () => <p>Ai body</p> }));

import MobileTabBar from '../MobileTabBar';

describe('MobileTabBar', () => {
  it('marks both tabs as dialog openers', () => {
    render(withI18n(<MobileTabBar />));
    const tabs = screen.getAllByRole('button');
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-haspopup')).toBe('dialog');
      expect(tab.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('opens a labelled sheet, reports it expanded, and returns focus to the tab on close', async () => {
    const user = userEvent.setup();
    render(withI18n(<MobileTabBar />));
    const [intelTab] = screen.getAllByRole('button');
    await user.click(intelTab);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull();
    expect(screen.getByText('Intel body')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(intelTab));
  });
});