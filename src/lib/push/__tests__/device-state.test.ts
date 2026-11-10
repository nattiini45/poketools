import { describe, expect, it } from 'vitest';
import { pushDeviceMachine, pushDeviceState, type PushDeviceFacts } from '../device-state';

describe('pushDeviceState', () => {
  it.each([
    [{ support: 'unsupported', optedIn: false }, 'unsupported'],
    [{ support: 'granted', optedIn: true, error: { code: 'push_disabled' } }, 'unsupported'],
    [{ support: 'install-required', optedIn: false }, 'install-required'],
    [{ support: 'denied', optedIn: false }, 'denied'],
    [{ support: 'default', optedIn: false }, 'ask'],
    [{ support: 'granted', optedIn: false }, 'off'],
    [{ support: 'granted', optedIn: true }, 'on'],
    [{ support: 'granted', optedIn: true, busy: true }, 'busy'],
    [{ support: 'default', optedIn: false, busy: true, error: null }, 'busy'],
    [{ support: 'granted', optedIn: false, error: { code: 'push_subscribe_failed' } }, 'failed'],
  ] as const)('%o → %s', (facts, state) => {
    expect(pushDeviceState(facts as PushDeviceFacts)).toBe(state);
  });

  it('a click switches only from ask, off, on and failed', () => {
    expect(pushDeviceMachine.sourcesOf('busy', 'viewer').sort()).toEqual(['ask', 'failed', 'off', 'on']);
  });
});
