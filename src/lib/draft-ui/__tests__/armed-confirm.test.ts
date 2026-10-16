import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armedConfirmReducer,
  canConfirm,
  INITIAL_ARMED_CONFIRM,
  scheduleArm,
  type ArmedConfirmAction,
  type ArmedConfirmState,
} from '@/lib/draft-ui/armed-confirm';
import { CONFIRM_ARM_MS } from '@/lib/draft-ui/constants';

/** A tiny store so the timer helper can dispatch into the reducer. */
function store() {
  let state: ArmedConfirmState = INITIAL_ARMED_CONFIRM;
  let cleanup: (() => void) | undefined;
  const dispatch = (action: ArmedConfirmAction) => {
    const next = armedConfirmReducer(state, action);
    if (next === state) return;
    state = next;
    cleanup?.();
    cleanup = scheduleArm(state, dispatch);
  };
  return { dispatch, get: () => state };
}

describe('armed confirm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms 1200 ms after opening', () => {
    expect(CONFIRM_ARM_MS).toBe(1200);
    const s = store();
    s.dispatch({ type: 'open' });
    expect(s.get().phase).toBe('arming');
    expect(canConfirm(s.get())).toBe(false);
    vi.advanceTimersByTime(1199);
    expect(canConfirm(s.get())).toBe(false);
    vi.advanceTimersByTime(1);
    expect(s.get().phase).toBe('armed');
    expect(canConfirm(s.get())).toBe(true);
  });

  it('ignores confirm while arming', () => {
    const s = store();
    s.dispatch({ type: 'open' });
    s.dispatch({ type: 'submit' });
    expect(s.get().phase).toBe('arming');
  });

  it('disables confirm while submitting', () => {
    const s = store();
    s.dispatch({ type: 'open' });
    vi.advanceTimersByTime(CONFIRM_ARM_MS);
    s.dispatch({ type: 'submit' });
    expect(s.get().phase).toBe('submitting');
    expect(canConfirm(s.get())).toBe(false);
    s.dispatch({ type: 'submit' });
    expect(s.get().phase).toBe('submitting');
  });

  it('re-arms after a validation error', () => {
    const s = store();
    s.dispatch({ type: 'open' });
    vi.advanceTimersByTime(CONFIRM_ARM_MS);
    s.dispatch({ type: 'submit' });
    s.dispatch({ type: 'failed' });
    expect(s.get().phase).toBe('arming');
    vi.advanceTimersByTime(CONFIRM_ARM_MS - 1);
    expect(canConfirm(s.get())).toBe(false);
    vi.advanceTimersByTime(1);
    expect(canConfirm(s.get())).toBe(true);
  });

  it('can return straight to armed (no re-arm)', () => {
    let state = armedConfirmReducer(INITIAL_ARMED_CONFIRM, { type: 'open' });
    state = armedConfirmReducer(state, { type: 'elapsed', token: state.armToken });
    state = armedConfirmReducer(state, { type: 'submit' });
    state = armedConfirmReducer(state, { type: 'failed', rearm: false });
    expect(state.phase).toBe('armed');
  });

  it('closes on success and arms again on the next open', () => {
    const s = store();
    s.dispatch({ type: 'open' });
    vi.advanceTimersByTime(CONFIRM_ARM_MS);
    s.dispatch({ type: 'submit' });
    s.dispatch({ type: 'succeeded' });
    expect(s.get().phase).toBe('closed');
    s.dispatch({ type: 'open' });
    expect(s.get()).toMatchObject({ phase: 'arming', openCount: 2 });
    vi.advanceTimersByTime(CONFIRM_ARM_MS);
    expect(s.get().phase).toBe('armed');
  });

  it('ignores a stale timer from an earlier arming', () => {
    let state = armedConfirmReducer(INITIAL_ARMED_CONFIRM, { type: 'open' });
    const stale = state.armToken;
    state = armedConfirmReducer(state, { type: 'close' });
    state = armedConfirmReducer(state, { type: 'open' });
    expect(armedConfirmReducer(state, { type: 'elapsed', token: stale }).phase).toBe('arming');
  });

  it('marks a caller-reported submission as busy and ignores failures outside a submission', () => {
    let state = armedConfirmReducer(INITIAL_ARMED_CONFIRM, { type: 'open' });
    expect(armedConfirmReducer(state, { type: 'failed' })).toBe(state);
    state = armedConfirmReducer(state, { type: 'busy' });
    expect(state.phase).toBe('submitting');
    expect(armedConfirmReducer(INITIAL_ARMED_CONFIRM, { type: 'busy' }).phase).toBe('closed');
  });

  it('schedules nothing outside the arming phase', () => {
    const dispatch = vi.fn();
    expect(scheduleArm(INITIAL_ARMED_CONFIRM, dispatch)).toBeUndefined();
  });
});
