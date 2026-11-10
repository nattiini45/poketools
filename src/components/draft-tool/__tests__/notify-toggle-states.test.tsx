/** @vitest-environment jsdom */
/**
 * The bell in every state of the push device machine (docs/push.md, "The bell, the device list and the states"):
 * label, pressed state and whether a click reaches the toggle.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { withI18n } from '@/test/i18n';
import NotifyToggle from '../feedback/NotifyToggle';
import type { NotifyState } from '../hooks/use-turn-watch';

function button(state: NotifyState) {
  render(withI18n(<NotifyToggle state={state} onToggle={vi.fn()} />, { locale: 'en' }));
  return screen.getByRole('button') as HTMLButtonElement;
}

describe('NotifyToggle states', () => {
  it.each([
    ['ask', { support: 'default', optedIn: false }, 'Turn on push alerts', null, false],
    ['off', { support: 'granted', optedIn: false }, 'Push alerts off for this device', 'false', false],
    ['on', { support: 'granted', optedIn: true }, 'Push alerts on for this device', 'true', false],
    ['busy (switching off)', { support: 'granted', optedIn: true, busy: true }, 'Working…', 'true', true],
    ['busy (asking)', { support: 'default', optedIn: false, busy: true }, 'Working…', null, true],
    ['failed (on)', { support: 'granted', optedIn: true, error: { code: 'push_unsubscribe_failed' } }, 'Push alerts on for this device', 'true', false],
    ['failed (ask)', { support: 'default', optedIn: false, error: { code: 'push_subscribe_failed' } }, 'Turn on push alerts', null, false],
  ] as const)('%s', (_name, state, label, pressed, disabled) => {
    const control = button(state as NotifyState);
    expect(control.textContent).toContain(label);
    expect(control.getAttribute('aria-pressed')).toBe(pressed);
    expect(control.disabled).toBe(disabled);
  });
});
