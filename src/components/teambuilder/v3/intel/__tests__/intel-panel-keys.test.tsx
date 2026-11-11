/** @vitest-environment jsdom */
/**
 * The Intel tablist's keyboard behaviour. The editor mounts the panel twice (the desktop column and
 * the phone sheet), so ids are per instance and an arrow key keeps focus in the tablist it was
 * pressed in.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import { EditorContext } from '../../editor/EditorContext';
import { createInitialState, type EditorState } from '../../editor/state';
import IntelPanel from '../IntelPanel';

vi.mock('../OverviewTab', () => ({ default: () => <p>Overview body</p> }));
vi.mock('../SetsTab', () => ({ default: () => <p>Sets body</p> }));
vi.mock('../CalcTab', () => ({ default: () => <p>Calc body</p> }));
vi.mock('../SpeedTab', () => ({ default: () => <p>Speed body</p> }));
vi.mock('../IntelSubjectStrip', () => ({ default: () => null }));

function TwoPanels() {
  const [state, setState] = useState<EditorState>(createInitialState);
  return (
    <EditorContext.Provider
      value={{
        state,
        dispatch: (action) => {
          if (action.type === 'SET_INTEL_TAB') setState((s) => ({ ...s, intelTab: action.tab }));
        },
      }}
    >
      <IntelPanel />
      <IntelPanel />
    </EditorContext.Provider>
  );
}

describe('IntelPanel tablist keys', () => {
  it('moves focus and selection inside the tablist that has focus', async () => {
    const user = userEvent.setup();
    render(withI18n(<TwoPanels />));
    const [, second] = screen.getAllByRole('tablist');
    const tabs = within(second).getAllByRole('tab');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(tabs[3]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[0]);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tabs[3]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('gives each instance its own tab and panel ids', () => {
    render(withI18n(<TwoPanels />));
    const ids = [...screen.getAllByRole('tab'), ...screen.getAllByRole('tabpanel')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const panel of screen.getAllByRole('tabpanel')) {
      expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.getAttribute('aria-controls')).toBe(
        panel.id,
      );
    }
  });
});
