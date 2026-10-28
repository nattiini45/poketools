/** @vitest-environment jsdom */
/**
 * `usePushAlerts` (the bell's state machine) against a mocked browser-push layer: what each browser state shows, what a
 * click does, and that nothing prompts or subscribes on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

const push = vi.hoisted(() => ({
  readPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

vi.mock('@/lib/push/client', () => ({
  readPushState: push.readPushState,
  enablePush: push.enablePush,
  disablePush: push.disablePush,
}));

import NotifyToggle from '../feedback/NotifyToggle';
import { usePushAlerts } from '../hooks/use-turn-watch';

function Bell() {
  const { state, toggle } = usePushAlerts();
  return <NotifyToggle state={state} onToggle={toggle} />;
}

function mount(locale: 'en' | 'de' = 'en') {
  return render(withI18n(<Bell />, { locale }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  push.readPushState.mockResolvedValue({ support: 'available', subscribed: false, askable: true });
  push.enablePush.mockResolvedValue({ ok: true });
  push.disablePush.mockResolvedValue({ ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('usePushAlerts', () => {
  it('renders nothing until the browser is read, then offers to turn push on (no prompt, no subscription)', async () => {
    const { container } = mount();
    expect(container.innerHTML).toBe('');
    await screen.findByRole('button', { name: 'Turn on push alerts' });
    expect(push.readPushState).toHaveBeenCalledWith('en');
    expect(push.enablePush).not.toHaveBeenCalled();
  });

  it('passes the page language so the server stores the language of the alerts', async () => {
    mount('de');
    await screen.findByRole('button', { name: 'Push-Benachrichtigungen aktivieren' });
    expect(push.readPushState).toHaveBeenCalledWith('de');
  });

  it('a click turns this device on and shows it on', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Turn on push alerts' }));
    expect(push.enablePush).toHaveBeenCalledWith('en');
    const on = await screen.findByRole('button', { name: 'Push alerts on for this device' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
  });

  it('a click on an already subscribed device turns it off', async () => {
    const user = userEvent.setup();
    push.readPushState.mockResolvedValue({ support: 'available', subscribed: true, askable: false });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Push alerts on for this device' }));
    expect(push.disablePush).toHaveBeenCalledTimes(1);
    expect(push.enablePush).not.toHaveBeenCalled();
    const off = await screen.findByRole('button', { name: 'Push alerts off for this device' });
    expect(off.getAttribute('aria-pressed')).toBe('false');
  });

  it('a refused permission prompt shows the blocked state', async () => {
    const user = userEvent.setup();
    push.enablePush.mockResolvedValue({ ok: false, reason: 'denied' });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Turn on push alerts' }));
    await screen.findByRole('button', { name: 'Blocked in browser settings' });
  });

  it('a dismissed prompt leaves the offer in place', async () => {
    const user = userEvent.setup();
    push.enablePush.mockResolvedValue({ ok: false, reason: 'dismissed' });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Turn on push alerts' }));
    await waitFor(() => expect(push.enablePush).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Turn on push alerts' });
  });

  it('a server refusal stays retryable and says why', async () => {
    const user = userEvent.setup();
    push.enablePush.mockResolvedValue({
      ok: false,
      reason: 'failed',
      failure: { ok: false, status: 400, error: { code: 'push_endpoint_not_allowed' } },
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Turn on push alerts' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('This browser’s push service is not supported.');
    expect((screen.getByRole('button', { name: 'Turn on push alerts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a server without push configuration hides the control', async () => {
    const user = userEvent.setup();
    push.enablePush.mockResolvedValue({
      ok: false,
      reason: 'failed',
      failure: { ok: false, status: 503, error: { code: 'push_disabled' } },
    });
    const { container } = mount();
    await user.click(await screen.findByRole('button', { name: 'Turn on push alerts' }));
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('a failed switch-off keeps the device on and shows the error', async () => {
    const user = userEvent.setup();
    push.readPushState.mockResolvedValue({ support: 'available', subscribed: true, askable: false });
    push.disablePush.mockResolvedValue({ ok: false, failure: { ok: false, status: 500, error: { code: 'push_unsubscribe_failed' } } });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Push alerts on for this device' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Failed to remove the push device');
    expect(screen.getByRole('button', { name: 'Push alerts on for this device' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores a second click while the first is running', async () => {
    const user = userEvent.setup();
    let finish: (value: { ok: true }) => void = () => undefined;
    push.enablePush.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount();
    const button = await screen.findByRole('button', { name: 'Turn on push alerts' });
    await user.click(button);
    await screen.findByRole('button', { name: 'Working…' });
    await user.click(screen.getByRole('button', { name: 'Working…' }));
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await screen.findByRole('button', { name: 'Push alerts on for this device' });
  });

  it('shows the Home Screen hint on iOS tabs and the blocked hint after a refusal elsewhere', async () => {
    push.readPushState.mockResolvedValue({ support: 'install-required', subscribed: false, askable: false });
    const first = mount();
    await screen.findByRole('button', { name: 'Add PokéTools to your Home Screen' });
    first.unmount();

    push.readPushState.mockResolvedValue({ support: 'denied', subscribed: false, askable: false });
    mount();
    await screen.findByRole('button', { name: 'Blocked in browser settings' });
  });

  it('stays hidden where push is unsupported, and survives a failing read', async () => {
    push.readPushState.mockResolvedValue({ support: 'unsupported', subscribed: false, askable: false });
    const { container, unmount } = mount();
    await waitFor(() => expect(push.readPushState).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    unmount();

    push.readPushState.mockRejectedValue(new Error('storage blocked'));
    const second = mount();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(second.container.innerHTML).toBe('');
  });

  it('removes the keys the old local alerts left in localStorage', async () => {
    window.localStorage.setItem('draft:notify:pool-1', '1');
    window.localStorage.setItem('draft:notified:pool-1:slot-1:turn', '1760000000000');
    window.localStorage.setItem('draft:prefs:v1', '{}');
    mount();
    await screen.findByRole('button', { name: 'Turn on push alerts' });
    expect(window.localStorage.getItem('draft:notify:pool-1')).toBeNull();
    expect(window.localStorage.getItem('draft:notified:pool-1:slot-1:turn')).toBeNull();
    expect(window.localStorage.getItem('draft:prefs:v1')).toBe('{}');
  });
});
