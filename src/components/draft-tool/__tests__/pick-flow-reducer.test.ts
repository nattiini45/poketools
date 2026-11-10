import { describe, expect, it } from 'vitest';
import {
  INITIAL_PICK_FLOW,
  pickFlowReducer,
  type PickFlowAction,
  type PickFlowState,
  type PickTarget,
} from '@/components/draft-tool/hooks/pick-flow';

const target = { slotId: 's1', lineId: 'l1', onBehalfOf: null } as unknown as PickTarget;
const opened = pickFlowReducer(INITIAL_PICK_FLOW, { type: 'open', target, requestId: 'r1' });
const submitting = pickFlowReducer(opened, { type: 'submit' });
const inlineError = pickFlowReducer(submitting, { type: 'failed', error: { code: 'OVERRIDE_REASON_REQUIRED' }, close: false });

const STATES: Record<string, PickFlowState> = { closed: INITIAL_PICK_FLOW, open: opened, submitting, openWithError: inlineError };

const ACTIONS: Record<string, PickFlowAction> = {
  open: { type: 'open', target: { ...target, slotId: 's2' }, requestId: 'r2' },
  submit: { type: 'submit' },
  failInline: { type: 'failed', error: { code: 'network_error' }, close: false },
  failClosing: { type: 'failed', error: { code: 'NOT_YOUR_TURN' }, close: true },
  succeeded: { type: 'succeeded' },
  cancel: { type: 'cancel' },
};

const phase = (s: PickFlowState) => (!s.open ? 'closed' : s.submitting ? 'submitting' : 'open');

/** Today's legal moves (draft-frontend §5.6): `same` = the reducer returns the state it was given. */
const EXPECTED: Record<string, Record<string, string>> = {
  closed: { open: 'open', submit: 'same', failInline: 'same', failClosing: 'same', succeeded: 'same', cancel: 'same' },
  open: { open: 'same', submit: 'submitting', failInline: 'open', failClosing: 'closed', succeeded: 'closed', cancel: 'closed' },
  openWithError: { open: 'same', submit: 'submitting', failInline: 'open', failClosing: 'closed', succeeded: 'closed', cancel: 'closed' },
  submitting: { open: 'same', submit: 'same', failInline: 'open', failClosing: 'closed', succeeded: 'closed', cancel: 'same' },
};

describe('pickFlowReducer: every action from every phase', () => {
  for (const [stateName, state] of Object.entries(STATES)) {
    for (const [actionName, action] of Object.entries(ACTIONS)) {
      it(`${stateName} + ${actionName} → ${EXPECTED[stateName][actionName]}`, () => {
        const next = pickFlowReducer(state, action);
        const expected = EXPECTED[stateName][actionName];
        if (expected === 'same') expect(next).toBe(state);
        else expect(phase(next)).toBe(expected);
      });
    }
  }

  it('keeps the request id across retries and mints a new one on the next open', () => {
    const retry = pickFlowReducer(pickFlowReducer(submitting, ACTIONS.failInline), { type: 'submit' });
    expect(retry.requestId).toBe('r1');
    expect(pickFlowReducer(submitting, ACTIONS.failInline)).toMatchObject({ retryable: true, error: { code: 'network_error' } });
    const reopened = pickFlowReducer(pickFlowReducer(retry, { type: 'succeeded' }), ACTIONS.open);
    expect(reopened).toMatchObject({ requestId: 'r2', openCount: 2, target: { slotId: 's2' }, error: null, retryable: false });
  });

  it('clears the error and the retry flag on submit and on close', () => {
    expect(pickFlowReducer(inlineError, { type: 'submit' })).toMatchObject({ error: null, retryable: false, submitting: true });
    expect(pickFlowReducer(inlineError, { type: 'cancel' })).toMatchObject({ error: null, retryable: false, open: false });
    expect(pickFlowReducer(submitting, ACTIONS.failClosing)).toMatchObject({ error: null, retryable: false, open: false });
  });
});
