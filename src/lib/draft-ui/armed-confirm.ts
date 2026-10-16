/**
 * The armed-confirm state machine behind `ArmedConfirmDialog`
 * (draft-frontend §5.5–§5.6). Pure apart from `scheduleArm`, which only
 * wraps `setTimeout`.
 *
 *   closed → arming → armed → submitting → closed (success)
 *                                       ↘ arming (failure: re-armed)
 *
 * The confirm button is enabled only in `armed`: it stays disabled for
 * `CONFIRM_ARM_MS` after every open and after every failed submission
 * (SPEC:494-497), and while a submission is in flight (SPEC:1011).
 */
import { CONFIRM_ARM_MS } from './constants';

export type ArmedConfirmPhase = 'closed' | 'arming' | 'armed' | 'submitting';

export interface ArmedConfirmState {
  phase: ArmedConfirmPhase;
  /** Bumps on every (re-)arming; a timer for an older token is ignored. */
  armToken: number;
  /** Bumps on every open. */
  openCount: number;
}

export type ArmedConfirmAction =
  | { type: 'open' }
  /** The arming timer for `token` elapsed. */
  | { type: 'elapsed'; token: number }
  /** The user confirmed (only from `armed`). */
  | { type: 'submit' }
  /** The caller reports a submission in flight (from any open phase). */
  | { type: 'busy' }
  /** The submission failed: re-arm (default) or go straight back to `armed`. */
  | { type: 'failed'; rearm?: boolean }
  | { type: 'succeeded' }
  | { type: 'close' };

export const INITIAL_ARMED_CONFIRM: ArmedConfirmState = Object.freeze({
  phase: 'closed',
  armToken: 0,
  openCount: 0,
});

export function armedConfirmReducer(state: ArmedConfirmState, action: ArmedConfirmAction): ArmedConfirmState {
  switch (action.type) {
    case 'open':
      if (state.phase !== 'closed') return state;
      return { phase: 'arming', armToken: state.armToken + 1, openCount: state.openCount + 1 };
    case 'elapsed':
      return state.phase === 'arming' && action.token === state.armToken ? { ...state, phase: 'armed' } : state;
    case 'submit':
      return state.phase === 'armed' ? { ...state, phase: 'submitting' } : state;
    case 'busy':
      return state.phase === 'closed' || state.phase === 'submitting' ? state : { ...state, phase: 'submitting' };
    case 'failed':
      if (state.phase !== 'submitting') return state;
      return action.rearm === false
        ? { ...state, phase: 'armed' }
        : { ...state, phase: 'arming', armToken: state.armToken + 1 };
    case 'succeeded':
    case 'close':
      return state.phase === 'closed' ? state : { ...state, phase: 'closed' };
    default:
      return state;
  }
}

/** The confirm button is enabled. */
export function canConfirm(state: ArmedConfirmState): boolean {
  return state.phase === 'armed';
}

/**
 * Starts the arming timer for the current token when the state is `arming`.
 * Returns the cleanup (for a `useEffect`), or undefined when nothing was scheduled.
 */
export function scheduleArm(
  state: ArmedConfirmState,
  dispatch: (action: ArmedConfirmAction) => void,
  armMs: number = CONFIRM_ARM_MS,
): (() => void) | undefined {
  if (state.phase !== 'arming') return undefined;
  const token = state.armToken;
  const id = setTimeout(() => dispatch({ type: 'elapsed', token }), Math.max(0, armMs));
  return () => clearTimeout(id);
}
