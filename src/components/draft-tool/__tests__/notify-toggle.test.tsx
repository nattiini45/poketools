/** @vitest-environment jsdom */
/**
 * The push bell (docs/push.md): one control, five states. The install and blocked states carry real hint text (touch
 * screens have no tooltips), and a server that answers `push_disabled` hides the control for good.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import NotifyToggle from '../feedback/NotifyToggle';
import { NOTIFY_UNSUPPORTED, type NotifyState } from '../hooks/use-turn-watch';

function show(state: NotifyState, props: { slow?: boolean; showNotes?: boolean; locale?: 'en' | 'de' } = {}) {
  const onToggle = vi.fn();
  const view = render(
    withI18n(<NotifyToggle state={state} onToggle={onToggle} slow={props.slow} showNotes={props.showNotes} />, {
      locale: props.locale ?? 'en',
    }),
  );
  return { onToggle, ...view };
}

describe('NotifyToggle', () => {
  it('renders nothing where push is unsupported', () => {
    const { container } = show(NOTIFY_UNSUPPORTED);
    expect(container.innerHTML).toBe('');
  });

  it('default: offers to turn push alerts on and never prompts by itself', async () => {
    const user = userEvent.setup();
    const { onToggle } = show({ support: 'default', optedIn: false });
    const button = screen.getByRole('button', { name: 'Turn on push alerts' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('granted and subscribed: a pressed switch for this device that turns it off', async () => {
    const user = userEvent.setup();
    const { onToggle } = show({ support: 'granted', optedIn: true });
    const button = screen.getByRole('button', { name: 'Push alerts on for this device' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('granted but not subscribed on this device: off, and one click turns it on', async () => {
    const user = userEvent.setup();
    const { onToggle } = show({ support: 'granted', optedIn: false });
    const button = screen.getByRole('button', { name: 'Push alerts off for this device' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('busy: disabled with a working label', () => {
    show({ support: 'granted', optedIn: false, busy: true });
    expect((screen.getByRole('button', { name: 'Working…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe('iOS / iPadOS in a browser tab', () => {
    it('says to add PokéTools to the Home Screen and explains how, on click, without toggling', async () => {
      const user = userEvent.setup();
      const { onToggle } = show({ support: 'install-required', optedIn: false });
      const button = screen.getByRole('button', { name: 'Add PokéTools to your Home Screen' });
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText(/Add to Home Screen/)).toBeNull();

      await user.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy as string)?.textContent).toMatch(/Home Screen/);
      expect(onToggle).not.toHaveBeenCalled();

      await user.click(button);
      expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
    });

    it('the players sheet shows the hint at once', () => {
      show({ support: 'install-required', optedIn: false }, { showNotes: true });
      expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    });

    it('is in German too', async () => {
      const user = userEvent.setup();
      show({ support: 'install-required', optedIn: false }, { locale: 'de' });
      await user.click(screen.getByRole('button', { name: 'PokéTools zum Home-Bildschirm hinzufügen' }));
      expect(screen.getByText(/Zum Home-Bildschirm/)).toBeTruthy();
    });
  });

  describe('denied', () => {
    it('says it is blocked and how to unblock it, and does not try to subscribe', async () => {
      const user = userEvent.setup();
      const { onToggle } = show({ support: 'denied', optedIn: false });
      const button = screen.getByRole('button', { name: 'Blocked in browser settings' });
      await user.click(button);
      expect(screen.getByText(/Allow notifications for this site in your browser settings/)).toBeTruthy();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('is in German too', async () => {
      const user = userEvent.setup();
      show({ support: 'denied', optedIn: false }, { locale: 'de' });
      await user.click(screen.getByRole('button', { name: 'In den Browser-Einstellungen blockiert' }));
      expect(screen.getByText(/Erlaube Benachrichtigungen für diese Seite/)).toBeTruthy();
    });
  });

  it('the players sheet adds the scope note, and slow drafts the Discord note', () => {
    show({ support: 'default', optedIn: false }, { showNotes: true, slow: true });
    expect(screen.getByText(/even when PokéTools is closed/)).toBeTruthy();
    expect(screen.getByText(/Discord pings still arrive/)).toBeTruthy();
  });

  it('shows a failed switch as an alert in the viewer language', () => {
    show({ support: 'granted', optedIn: false, error: { code: 'push_endpoint_not_allowed' } }, { locale: 'de' });
    expect(screen.getByRole('alert').textContent).toBe('Der Push-Dienst dieses Browsers wird nicht unterstützt.');
  });

  it('hides for good once the server says push is not set up', () => {
    const { container } = show({ support: 'granted', optedIn: false, error: { code: 'push_disabled' } });
    expect(container.innerHTML).toBe('');
  });

  it('uses theme tokens only (no fixed colours) in the states it renders', () => {
    const { container } = show({ support: 'install-required', optedIn: false, error: { code: 'push_subscribe_failed' } });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|bg-black|bg-gray-9|bg-slate-9|rgb\(/);
  });
});
