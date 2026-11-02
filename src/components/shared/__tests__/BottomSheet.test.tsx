/** @vitest-environment jsdom */
/**
 * BottomSheet is a modal dialog: it has the dialog role and is named by its title, moves focus in on open, keeps Tab
 * inside, closes with Escape, its visible close button or a downward swipe on the handle, and hands focus back to the
 * element that opened it.
 */
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import BottomSheet from '../BottomSheet';

function Harness({ title, onClose }: { title?: string; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <button type="button">Behind</button>
      <BottomSheet
        open={open}
        title={title}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </BottomSheet>
    </>
  );
}

/** A touch point as both lists carry it (document-level scroll-lock listeners read changedTouches). */
const touch = (clientY: number) => ({ touches: [{ clientX: 0, clientY }], changedTouches: [{ clientX: 0, clientY }] });

async function openSheet(ui = <Harness title="Team intel" />, locale: 'en' | 'de' = 'en') {
  const user = userEvent.setup();
  render(withI18n(ui, { locale }));
  const opener = screen.getByRole('button', { name: 'Open sheet' });
  await user.click(opener);
  return { user, opener };
}

describe('BottomSheet', () => {
  it('renders nothing while closed', () => {
    render(withI18n(<Harness title="Team intel" />));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a dialog named by its title', async () => {
    await openSheet();
    expect(screen.getByRole('dialog', { name: 'Team intel' })).toBeTruthy();
  });

  it('falls back to a screen-reader title when none is given', async () => {
    await openSheet(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeTruthy();
  });

  it('moves focus into the sheet on open', async () => {
    await openSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keeps Tab and Shift+Tab inside the sheet', async () => {
    const { user } = await openSheet();
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('has a visible close button', async () => {
    await openSheet();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('labels the close button in German', async () => {
    await openSheet(<Harness title="Team-Intel" />, 'de');
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy();
  });

  it('closes with Escape and returns focus to the opener', async () => {
    const onClose = vi.fn();
    const { user, opener } = await openSheet(<Harness title="Team intel" onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('closes with the close button and returns focus to the opener', async () => {
    const onClose = vi.fn();
    const { user, opener } = await openSheet(<Harness title="Team intel" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('closes on a downward swipe of more than 100 px on the handle', async () => {
    const onClose = vi.fn();
    await openSheet(<Harness title="Team intel" onClose={onClose} />);
    const handle = document.querySelector('[data-bottom-sheet-handle]');
    expect(handle).not.toBeNull();
    fireEvent.touchStart(handle as Element, touch(100));
    fireEvent.touchEnd(handle as Element, touch(160));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.touchStart(handle as Element, touch(100));
    fireEvent.touchEnd(handle as Element, touch(240));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the page behind from assistive technology while open', async () => {
    await openSheet();
    expect(screen.queryByRole('button', { name: 'Behind' })).toBeNull();
  });
});
