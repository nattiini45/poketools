import { describe, expect, it } from 'vitest';
import {
  armedConfirmReducer,
  INITIAL_ARMED_CONFIRM,
  type ArmedConfirmAction,
  type ArmedConfirmPhase,
  type ArmedConfirmState,
} from '@/lib/draft-ui/armed-confirm';

const at = (phase: ArmedConfirmPhase): ArmedConfirmState => ({ phase, armToken: 3, openCount: 2 });

const ACTIONS: Record<string, ArmedConfirmAction> = {
  open: { type: 'open' },
  elapsed: { type: 'elapsed', token: 3 },
  elapsedStale: { type: 'elapsed', token: 2 },
  submit: { type: 'submit' },
  busy: { type: 'busy' },
  failed: { type: 'failed' },
  failedNoRearm: { type: 'failed', rearm: false },
  succeeded: { type: 'succeeded' },
  close: { type: 'close' },
};

/** Today's legal moves (draft-frontend §5.5–§5.6): `same` = the reducer returns the state it was given. */
const EXPECTED: Record<ArmedConfirmPhase, Record<string, ArmedConfirmPhase | 'same'>> = {
  closed: { open: 'arming', elapsed: 'same', elapsedStale: 'same', submit: 'same', busy: 'same', failed: 'same', failedNoRearm: 'same', succeeded: 'same', close: 'same' },
  arming: { open: 'same', elapsed: 'armed', elapsedStale: 'same', submit: 'same', busy: 'submitting', failed: 'same', failedNoRearm: 'same', succeeded: 'closed', close: 'closed' },
  armed: { open: 'same', elapsed: 'same', elapsedStale: 'same', submit: 'submitting', busy: 'submitting', failed: 'same', failedNoRearm: 'same', succeeded: 'closed', close: 'closed' },
  submitting: { open: 'same', elapsed: 'same', elapsedStale: 'same', submit: 'same', busy: 'same', failed: 'arming', failedNoRearm: 'armed', succeeded: 'closed', close: 'closed' },
};

describe('armedConfirmReducer: every action from every phase', () => {
  for (const phase of Object.keys(EXPECTED) as ArmedConfirmPhase[]) {
    for (const [name, action] of Object.entries(ACTIONS)) {
      it(`${phase} + ${name} → ${EXPECTED[phase][name]}`, () => {
        const state = at(phase);
        const next = armedConfirmReducer(state, action);
        const expected = EXPECTED[phase][name];
        if (expected === 'same') expect(next).toBe(state);
        else expect(next.phase).toBe(expected);
      });
    }
  }

  it('bumps the arm token on open and on a re-arming failure only, and the open count on open only', () => {
    expect(armedConfirmReducer(INITIAL_ARMED_CONFIRM, { type: 'open' })).toEqual({ phase: 'arming', armToken: 1, openCount: 1 });
    expect(armedConfirmReducer(at('submitting'), { type: 'failed' })).toEqual({ phase: 'arming', armToken: 4, openCount: 2 });
    expect(armedConfirmReducer(at('submitting'), { type: 'failed', rearm: false })).toEqual({ phase: 'armed', armToken: 3, openCount: 2 });
    expect(armedConfirmReducer(at('armed'), { type: 'close' })).toEqual({ phase: 'closed', armToken: 3, openCount: 2 });
  });
});
