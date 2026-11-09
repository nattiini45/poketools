import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The Cast Studio autosave (docs/state-machines.md, "Cast Studio autosave"):
 * a client flow in `CastStudioContext`. Every studio action is an edit; 5 s
 * after the last one the whole snapshot goes to PATCH /api/cast-sessions/[id].
 * The request keeps the signature of the body it sent, so an edit made while
 * it runs is still unsaved when it succeeds. A failed request (an HTTP error,
 * `success: false` or no answer) shows as an error until the next edit
 * retries.
 */
export const castStudioSaveMachine = defineMachine({
  id: 'cast_studio_save',
  title: 'Cast Studio autosave',
  storage: 'CastStudioState.save in src/components/creator/studio/CastStudioContext.tsx (client only)',
  summary:
    'The save badge of the Cast Studio (CastToolbar). Edits from this tab and from another tab over the cast channel both count; one request runs at a time, and its answer is compared with the session as it is when the answer lands (the sent signature). A pagehide sends any unsaved snapshot with keepalive and does not move the state.',
  doc: 'docs/cast-studio.md',
  states: ['idle', 'dirty', 'saving', 'error'],
  initial: ['idle'],
  terminal: [],
  actors: ['caster', 'autosave'],
  transitions: [
    {
      event: 'edit',
      from: ['idle', 'dirty', 'error'],
      to: 'dirty',
      actors: ['caster'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: 'Any studio action; after a failed save the edit schedules the retry.',
    },
    {
      event: 'edit',
      from: ['saving'],
      to: 'saving',
      actors: ['caster'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: 'The running request keeps its snapshot; the sent signature decides when it answers.',
    },
    {
      event: 'save_start',
      from: ['dirty'],
      to: 'saving',
      actors: ['autosave'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: '5 s after the last edit; never while another save runs.',
    },
    {
      event: 'save_ok',
      from: ['saving'],
      to: 'idle',
      actors: ['autosave'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: 'The server stored the snapshot and the session has not changed since it was sent.',
    },
    {
      event: 'save_ok_outdated',
      from: ['saving'],
      to: 'dirty',
      actors: ['autosave'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: 'The server stored the snapshot but the session changed while the request ran: the next save follows.',
    },
    {
      event: 'save_fail',
      from: ['saving'],
      to: 'error',
      actors: ['autosave'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: 'An HTTP error, success: false, or no answer: the badge shows the failure.',
    },
    {
      event: 'load',
      from: ['idle', 'dirty', 'saving', 'error'],
      to: 'idle',
      actors: ['caster'],
      writers: ['src/components/creator/studio/CastStudioContext.tsx'],
      note: 'A stored session replaces the studio state (the load_session action).',
    },
  ],
});
