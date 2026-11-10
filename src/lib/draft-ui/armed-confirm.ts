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
import { defineMachine } from '@/lib/state-machine/machine';
import { CONFIRM_ARM_MS } from './constants';

export const ARMED_CONFIRM_PHASES = ['closed', 'arming', 'armed', 'submitting'] as const;
export type ArmedConfirmPhase = (typeof ARMED_CONFIRM_PHASES)[number];

type ArmedConfirmActor = 'viewer' | 'timer' | 'flow';

const WRITERS = ['src/lib/draft-ui/armed-confirm.ts', 'src/components/draft-tool/shared/ArmedConfirmDialog.tsx'];

/**
 * The legal moves of the armed confirm. `viewer` is the person at the dialog, `timer` the arming delay, `flow` the
 * pick submission the dialog reports on (`busy`, `failed`, `succeeded`). `armedConfirmReducer` asks it before every move.
 */
export const armedConfirmMachine = defineMachine({
  id: 'draft_room.armed_confirm',
  title: 'Draft room armed confirm',
  storage: 'client: armedConfirmReducer phase in ArmedConfirmDialog',
  summary:
    'The confirm button of a pick or token dialog is enabled only in armed: it stays disabled for CONFIRM_ARM_MS after every open and after every re-arming failure, and while a submission is in flight. A timer for an older arm token is ignored.',
  states: ARMED_CONFIRM_PHASES,
  initial: ['closed'],
  terminal: [],
  actors: ['viewer', 'timer', 'flow'],
  transitions: [
    { event: 'open', from: ['closed'], to: 'arming', actors: ['viewer'], writers: WRITERS },
    { event: 'elapsed', from: ['arming'], to: 'armed', actors: ['timer'], writers: WRITERS, note: 'Only the timer of the current arm token.' },
    { event: 'submit', from: ['armed'], to: 'submitting', actors: ['viewer'], writers: WRITERS },
    { event: 'busy', from: ['arming', 'armed'], to: 'submitting', actors: ['flow'], writers: WRITERS, note: 'The caller reports a submission in flight.' },
    { event: 'fail_rearm', from: ['submitting'], to: 'arming', actors: ['flow'], writers: WRITERS, note: 'Default after a failure: a new arm token.' },
    { event: 'fail', from: ['submitting'], to: 'armed', actors: ['flow'], writers: WRITERS, note: '`failed` with `rearm: false`.' },
    { event: 'succeed', from: ['arming', 'armed', 'submitting'], to: 'closed', actors: ['flow'], writers: WRITERS },
    { event: 'close', from: ['arming', 'armed', 'submitting'], to: 'closed', actors: ['viewer'], writers: WRITERS },
  ],
  doc: 'docs/draft-room.md',
});

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
  const can = (to: ArmedConfirmPhase, actor: ArmedConfirmActor) => armedConfirmMachine.can(state.phase, to, actor);
  switch (action.type) {
    case 'open':
      return can('arming', 'viewer') ? { phase: 'arming', armToken: state.armToken + 1, openCount: state.openCount + 1 } : state;
    case 'elapsed':
      return can('armed', 'timer') && action.token === state.armToken ? { ...state, phase: 'armed' } : state;
    case 'submit':
      return can('submitting', 'viewer') ? { ...state, phase: 'submitting' } : state;
    case 'busy':
      return can('submitting', 'flow') ? { ...state, phase: 'submitting' } : state;
    case 'failed':
      if (action.rearm === false) return can('armed', 'flow') ? { ...state, phase: 'armed' } : state;
      return can('arming', 'flow') ? { ...state, phase: 'arming', armToken: state.armToken + 1 } : state;
    case 'succeeded':
      return can('closed', 'flow') ? { ...state, phase: 'closed' } : state;
    case 'close':
      return can('closed', 'viewer') ? { ...state, phase: 'closed' } : state;
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
