import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The push control of THIS browser (the draft room's bell, docs/push.md "The bell, the device list and the states"),
 * derived from one function. Client-safe.
 *
 * - `unsupported`: no push here, or the server is not configured for it (`push_disabled`): the control is hidden.
 * - `install-required`: iPhone/iPad in a browser tab; `denied`: blocked in the browser settings. Both show a hint.
 * - `ask`: permission never asked; `off` / `on`: permission granted, this device unsubscribed / subscribed.
 * - `busy`: a subscribe or unsubscribe is running; `failed`: the last one failed (retryable, the error shows).
 */
export const PUSH_DEVICE_STATES = ['unsupported', 'install-required', 'denied', 'ask', 'off', 'on', 'busy', 'failed'] as const;
export type PushDeviceState = (typeof PUSH_DEVICE_STATES)[number];

/** The facts the bell holds (`NotifyState` of `use-turn-watch.ts`). */
export interface PushDeviceFacts {
  support: 'unsupported' | 'install-required' | 'default' | 'granted' | 'denied';
  optedIn: boolean;
  busy?: boolean;
  error?: { code?: string } | null;
}

/** The state without a running or failed switch: what the control says it would switch. */
export function restingPushDeviceState(facts: PushDeviceFacts): Exclude<PushDeviceState, 'busy' | 'failed'> {
  if (facts.support === 'unsupported' || facts.error?.code === 'push_disabled') return 'unsupported';
  if (facts.support === 'install-required' || facts.support === 'denied') return facts.support;
  if (facts.support === 'default') return 'ask';
  return facts.optedIn ? 'on' : 'off';
}

export function pushDeviceState(facts: PushDeviceFacts): PushDeviceState {
  const resting = restingPushDeviceState(facts);
  if (resting === 'unsupported' || resting === 'install-required' || resting === 'denied') return resting;
  if (facts.busy) return 'busy';
  return facts.error ? 'failed' : resting;
}

const HOOK = 'src/components/draft-tool/hooks/use-turn-watch.ts';
const READ_TARGETS = ['unsupported', 'install-required', 'denied', 'ask', 'off', 'on'] as const;

export const pushDeviceMachine = defineMachine({
  id: 'push.device',
  title: 'Push device (this browser)',
  storage: 'client: NotifyState in usePushAlerts (browser permission + PushManager subscription)',
  summary:
    'Whether THIS browser gets push alerts. The browser read on mount (and on a language change) sets the state from the permission and the subscription; a click on the bell switches it through busy. A server that answers push_disabled hides the control for good.',
  states: PUSH_DEVICE_STATES,
  initial: ['unsupported'],
  terminal: [],
  actors: ['browser', 'viewer', 'switch'],
  transitions: [
    ...READ_TARGETS.map((to) => ({
      event: `read_${to}`,
      from: PUSH_DEVICE_STATES,
      to,
      actors: ['browser' as const],
      writers: [HOOK, 'src/lib/push/client.ts'],
      note: 'readPushState after mount or a language change.',
    })),
    { event: 'toggle', from: ['ask', 'off', 'on', 'failed'], to: 'busy', actors: ['viewer'], writers: [HOOK, 'src/components/draft-tool/feedback/NotifyToggle.tsx'], note: 'Only a click; install-required and denied open their hint instead.' },
    { event: 'enabled', from: ['busy'], to: 'on', actors: ['switch'], writers: [HOOK, 'src/lib/push/client.ts'] },
    { event: 'disabled', from: ['busy'], to: 'off', actors: ['switch'], writers: [HOOK, 'src/lib/push/client.ts'] },
    { event: 'dismissed', from: ['busy'], to: 'ask', actors: ['switch'], writers: [HOOK], note: 'The permission prompt was closed without an answer.' },
    { event: 'refused', from: ['busy'], to: 'denied', actors: ['switch'], writers: [HOOK] },
    { event: 'fail', from: ['busy'], to: 'failed', actors: ['switch'], writers: [HOOK], note: 'Keeps the previous on/off; retryable.' },
    { event: 'push_disabled', from: ['busy'], to: 'unsupported', actors: ['switch'], writers: [HOOK], note: 'The server has no push configuration, or the browser cannot subscribe.' },
  ],
  doc: 'docs/push.md',
});
