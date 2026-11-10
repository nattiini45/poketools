import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The pick confirmation dialog of the draft room (draft-frontend §5.6) as a machine. `pickFlowReducer`
 * (`src/components/draft-tool/hooks/pick-flow.ts`) keeps the dialog's data (target, request id, error) and asks this
 * machine whether an action moves the dialog at all; an action it refuses leaves the state untouched.
 *
 * `viewer` is the player (or admin picking on behalf) at the screen; `server` is the answer to a submitted pick.
 */
export const PICK_FLOW_PHASES = ['closed', 'open', 'submitting'] as const;
export type PickFlowPhase = (typeof PICK_FLOW_PHASES)[number];

const WRITERS = ['src/components/draft-tool/hooks/pick-flow.ts', 'src/components/draft-tool/DraftToolClient.tsx'];

export const pickFlowMachine = defineMachine({
  id: 'draft_room.pick_flow',
  title: 'Draft room pick dialog',
  storage: 'client: pickFlowReducer state (open, submitting) in DraftToolClient',
  summary:
    'The confirm dialog of one pick. The request id minted on open is reused for every retry of that dialog (idempotent on the server); a cancel is refused while a pick is in flight. A server answer either closes the dialog (success, or an error that makes it moot: CLOSING_PICK_ERRORS) or reopens it with the error inline (network errors offer Retry).',
  states: PICK_FLOW_PHASES,
  initial: ['closed'],
  terminal: [],
  actors: ['viewer', 'server'],
  transitions: [
    { event: 'open', from: ['closed'], to: 'open', actors: ['viewer'], writers: WRITERS, note: 'Mints the request id; an open dialog ignores a second open.' },
    { event: 'submit', from: ['open'], to: 'submitting', actors: ['viewer'], writers: WRITERS, note: 'Clears the previous error.' },
    { event: 'cancel', from: ['open'], to: 'closed', actors: ['viewer'], writers: WRITERS, note: 'Not while a pick is in flight.' },
    { event: 'settle', from: ['open', 'submitting'], to: 'closed', actors: ['server'], writers: WRITERS, note: 'Success, or a closing error (toast + refresh).' },
    { event: 'reject', from: ['open', 'submitting'], to: 'open', actors: ['server'], writers: WRITERS, note: 'A validation or network error stays inline; network errors set retryable.' },
  ],
  doc: 'docs/draft-room.md',
});
