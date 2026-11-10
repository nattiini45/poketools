import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The two machines of a player action (`player.action` rules of a kit format, docs/format-kit.md): the window the
 * action is in, and each player's submission. They are separate states that only meet in `lock_action`: locking the
 * window also locks every submitted pick, while opening it again leaves locked picks locked. Every write happens inside
 * the SQL functions named as writers, under the action's advisory lock; `src/lib/format-engine/runtime/__tests__/state-machines-sql.test.ts`
 * holds their guards equal to these definitions. Client-safe.
 */

const RUNTIME_SQL = 'supabase/migrations/20261105090000_format_runtime.sql';
const SAVE_SQL = 'supabase/migrations/20261109090000_format_action_save_draft_only.sql';

/**
 * `format_flags` key `action:<id>` ("open" | "locked" | absent) read together with the rule's `window.opens_on`:
 * an absent flag reads `open` when the rule has no `opens_on`, else `not_open_yet` (`windowOf` in views.ts).
 */
export const actionWindowMachine = defineMachine({
  id: 'format_action_window',
  title: 'Format action window',
  storage: "format_flags 'action:<id>' + the rule's window.opens_on",
  summary:
    "When players may pick for a player action. The format's events and time marks open and lock it (format__apply_ops writes the flag unconditionally, so the system may repeat a move); an admin opens or locks it with an action adjustment, which refuses a move to the state the window is already in (action_state_unchanged). Opening a locked window does not unlock the picks the lock made final.",
  doc: 'docs/format-kit.md',
  states: ['not_open_yet', 'open', 'locked'],
  initial: ['not_open_yet', 'open'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'open',
      from: ['not_open_yet', 'locked'],
      to: 'open',
      actors: ['admin'],
      writers: ['src/lib/format-engine/runtime/adjust.ts', `${RUNTIME_SQL}#format__apply_ops`],
      note: 'Action adjustment with state open. Reopening a locked window leaves locked picks locked.',
    },
    {
      event: 'open',
      from: ['not_open_yet', 'open', 'locked'],
      to: 'open',
      actors: ['system'],
      writers: ['src/lib/format-engine/runtime/effects.ts', `${RUNTIME_SQL}#format__apply_ops`],
      note: "An event or time mark the rule's window.opens_on matches (open_action op). A late open after a lock reopens the window; the cron replays due marks in order (calendar.ts) so a later mark's lock wins.",
    },
    {
      event: 'lock',
      from: ['not_open_yet', 'open'],
      to: 'locked',
      actors: ['admin'],
      writers: ['src/lib/format-engine/runtime/adjust.ts', `${RUNTIME_SQL}#format__apply_ops`],
      note: 'Action adjustment with state locked: locks every submitted pick too and fires action_locked.',
    },
    {
      event: 'lock',
      from: ['not_open_yet', 'open', 'locked'],
      to: 'locked',
      actors: ['system'],
      writers: [
        'src/lib/format-engine/runtime/effects.ts',
        'src/lib/format-engine/runtime/cron.ts',
        `${RUNTIME_SQL}#format__apply_ops`,
      ],
      note: "An event or time mark the rule's window.closes_on matches, or the cron's auto_lock policy (lock_action op): locks every submitted pick too.",
    },
  ],
});

export type ActionWindowState = (typeof actionWindowMachine.spec.states)[number];

/** `format_action_submissions.status`: one player's pick for one action. */
export const actionSubmissionMachine = defineMachine({
  id: 'format_action_submission',
  title: 'Format action submission',
  storage: 'format_action_submissions.status',
  summary:
    "A player's pick for one player action. A draft is saved, a submission grants the pick's items, and a lock makes it final. Every writer in SQL refuses a locked row (action_locked); format_action_save writes only a draft and refuses a submitted pick under the action's lock (action_already_submitted, answered as format_action_already_submitted), so a save never demotes a submission.",
  doc: 'docs/format-kit.md',
  states: ['draft', 'submitted', 'locked'],
  initial: ['draft'],
  terminal: ['locked'],
  actors: ['player', 'admin', 'system'],
  transitions: [
    {
      event: 'save',
      from: ['draft'],
      to: 'draft',
      actors: ['player'],
      writers: ['src/lib/format-engine/runtime/actions-server.ts', `${SAVE_SQL}#format_action_save`],
      note: 'Save draft. The first save inserts the row.',
    },
    {
      event: 'submit',
      from: ['draft', 'submitted'],
      to: 'submitted',
      actors: ['player'],
      writers: ['src/lib/format-engine/runtime/actions-server.ts', `${RUNTIME_SQL}#format_action_submit`],
      note: 'Submit, or submit again: the new picks replace the old ones and their items; submitted_at records the last submission.',
    },
    {
      event: 'submit_final',
      from: ['draft', 'submitted'],
      to: 'locked',
      actors: ['player'],
      writers: ['src/lib/format-engine/runtime/actions-server.ts', `${RUNTIME_SQL}#format_action_submit`],
      note: "Submit on an action whose lock is on_submit: the pick is final at once.",
    },
    {
      event: 'draw',
      from: ['draft'],
      to: 'submitted',
      actors: ['system'],
      writers: ['src/lib/format-engine/runtime/cron.ts', `${RUNTIME_SQL}#format_action_submit`],
      note: "The cron's deadline pick (seeded_random_pick) for a player who has not submitted: p_only_if_unsubmitted refuses anything but a draft or no row (action_already_submitted).",
    },
    {
      event: 'draw_final',
      from: ['draft'],
      to: 'locked',
      actors: ['system'],
      writers: ['src/lib/format-engine/runtime/cron.ts', `${RUNTIME_SQL}#format_action_submit`],
      note: 'The deadline pick on an action whose lock is on_submit.',
    },
    {
      event: 'lock',
      from: ['submitted'],
      to: 'locked',
      actors: ['admin', 'system'],
      writers: ['src/lib/format-engine/runtime/adjust.ts', 'src/lib/format-engine/runtime/effects.ts', `${RUNTIME_SQL}#format__apply_ops`],
      note: 'The window locks (lock_action op): every submitted pick becomes final. A draft stays a draft: it is not a submission.',
    },
  ],
});

export type ActionSubmissionState = (typeof actionSubmissionMachine.spec.states)[number];
