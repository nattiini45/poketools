import { defineMachine } from '@/lib/state-machine/machine';
import type { DraftPhase, PoolStatus } from '@/types/draft-queue';

/**
 * The queue-engine draft pool as explicit machines (ADR 0004). Client-safe.
 *
 * Every move is written inside a `draft_*` RPC under `draft__lock` (the season advisory lock plus the pool row
 * FOR UPDATE), so SQL is the enforcing side: the functions keep their own guards, these definitions name them as
 * writers (`path#function`, the migration that holds the function's latest definition), and
 * `__tests__/pool-phase-state-sql.test.ts` holds each definition equal to those guards. UI derives the actions it
 * offers from `transitionsFrom`.
 */

const LG = 'supabase/migrations/20261018180000_league_groups.sql';
const CP = 'supabase/migrations/20261018140200_draft_pool_completability.sql';
const QH = 'supabase/migrations/20261018140100_draft_quiet_hours.sql';
const SR = 'supabase/migrations/20261027190000_draft_start_reroll_every_two_rounds.sql';
const DD = 'supabase/migrations/20261102150000_draft_list_due_pools.sql';
const RR = 'supabase/migrations/20261012025023_redraft_rpcs.sql';
const LT = 'supabase/migrations/20261026091000_league_trash.sql';

export const draftPoolPhaseMachine = defineMachine({
  id: 'draft_pool.phase',
  title: 'Draft pool (queue engine)',
  storage: "draft_pools.phase where engine = 'queue' (+ the status twin)",
  summary:
    "An Initial draft starts in setup, a Redraft in submissions (created by draft_create_pool). Every writer sets status next to phase (DRAFT_PHASE_STATUS: setup → pending, submissions and drafting → in_progress, complete and cancelled → complete); no CHECK ties them, so read phase, never status, to tell a cancelled pool from a complete one. Inside drafting the clock can be paused (draft_pool.pause); inside submissions the drops lock when the deadline passes (redraft.submission_window). complete is not terminal: voiding a pick reopens the draft, paused. A pool leaves the machine only by DELETE (setup or cancelled, DELETABLE_QUEUE_PHASES). The system moves run inside reads too: draft_snapshot (GET /api/drafts/[id]/state), draft_my_turn and the draft-ticks cron all call draft__tick.",
  doc: 'docs/draft-room.md',
  states: ['setup', 'submissions', 'drafting', 'complete', 'cancelled'],
  initial: ['setup', 'submissions'],
  terminal: ['cancelled'],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'start',
      from: ['setup'],
      to: 'drafting',
      actors: ['admin'],
      writers: [`${SR}#draft_start`, 'src/app/api/drafts/[id]/start/route.ts'],
      note: 'Initial drafts only (a Redraft answers SUBMISSION_PHASE); a started pool answers DRAFT_ALREADY_STARTED. Clears any pause.',
    },
    {
      event: 'publish',
      from: ['submissions'],
      to: 'drafting',
      actors: ['admin', 'system'],
      writers: [`${LG}#redraft__publish_locked`, `${RR}#redraft_publish`, `${DD}#draft__tick`],
      note: 'An admin publishes the drops (before the deadline only with force and a reason), or draft__tick does once the deadline passed; a refused publish stays in submissions with a backoff.',
    },
    {
      event: 'complete',
      from: ['drafting'],
      to: 'complete',
      actors: ['system'],
      writers: [`${CP}#draft__activate_next`],
      note: 'The queue runs empty after a pick, a timeout, a resume or a restored drop; clears the pause and stamps ended_at.',
    },
    {
      event: 'abort',
      from: ['drafting'],
      to: 'cancelled',
      actors: ['admin'],
      writers: [`${LG}#draft_end`, 'src/app/api/drafts/[id]/end/route.ts'],
      note: 'Initial drafts only (a running Redraft answers DRAFT_ABORT_NOT_ALLOWED): voids every live pick and discards the open slots.',
    },
    {
      event: 'cancel_submissions',
      from: ['submissions'],
      to: 'cancelled',
      actors: ['admin'],
      writers: [`${LG}#draft_end`, 'src/app/api/drafts/[id]/end/route.ts'],
      note: 'A Redraft still collecting drops (API only, no button).',
    },
    {
      event: 'reopen',
      from: ['complete'],
      to: 'drafting',
      actors: ['admin'],
      writers: [
        `${LG}#draft_admin_void_pick`,
        'src/app/api/drafts/[id]/picks/[pickId]/void/route.ts',
        'src/app/api/drafts/[id]/picks/[pickId]/correct/route.ts',
      ],
      note: 'Voiding (or correcting) a pick of a complete draft requeues its slot and reopens the draft paused (pause_reason admin, ended_at cleared). The Draft Kill Token window falls back to before.',
    },
  ],
});

/**
 * The `status` every RPC writes next to `phase` (the twin). Lossy on purpose: a cancelled pool reads as complete
 * to anything that keys on status, so UI keys on phase (`draftPoolDisplayStatus`).
 */
export const DRAFT_PHASE_STATUS: { readonly [P in DraftPhase]: PoolStatus } = {
  setup: 'pending',
  submissions: 'in_progress',
  drafting: 'in_progress',
  complete: 'complete',
  cancelled: 'complete',
};

/** What a pool reads as in the UI: its status, except that a cancelled pool reads as cancelled, not complete. */
export function draftPoolDisplayStatus(pool: { phase: DraftPhase; status: PoolStatus }): PoolStatus | 'cancelled' {
  return pool.phase === 'cancelled' ? 'cancelled' : pool.status;
}

/**
 * The pause sub-state of a drafting pool: `paused_at` (+ `paused_by`, `pause_reason`). Only a drafting pool is
 * paused: draft_start and the publish clear the columns when they enter drafting, draft_end when it cancels.
 */
export const draftPoolPauseMachine = defineMachine({
  id: 'draft_pool.pause',
  title: 'Draft pool pause',
  storage: "draft_pools.paused_at (+ paused_by, pause_reason) while phase = 'drafting'",
  summary:
    "A paused pool runs no clock: the active slot's deadline_at is NULL and remaining_ms_at_pause holds its rest, and draft__resolve_timeouts skips the pool. Pick corrections (void, correct, restore a drop) need a paused drafting pool or a complete one (CORRECTION_REQUIRES_PAUSE). pause_reason 'blocked_slot' is retired: nothing writes it any more.",
  doc: 'docs/draft-room.md',
  states: ['running', 'paused'],
  initial: ['running'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'pause',
      from: ['running'],
      to: 'paused',
      actors: ['admin'],
      writers: [`${QH}#draft_set_paused`, 'src/app/api/drafts/[id]/pause/route.ts', `${LG}#draft_admin_void_pick`],
      note: 'A paused pool answers ALREADY_PAUSED; outside drafting DRAFT_NOT_ACTIVE. A complete pool (never paused) reopened by a void also comes back paused.',
    },
    {
      event: 'freeze',
      from: ['running'],
      to: 'paused',
      actors: ['system'],
      writers: [`${LT}#league_trash_delete`],
      note: 'Moving a league to the recycle bin pauses its running drafts; restoring it keeps them paused.',
    },
    {
      event: 'resume',
      from: ['paused'],
      to: 'running',
      actors: ['admin'],
      writers: [`${QH}#draft_set_paused`, `${QH}#draft__resume`, 'src/app/api/drafts/[id]/pause/route.ts'],
      note: 'A running pool answers NOT_PAUSED. Restarts the active clock with its remaining time, or activates the next slot.',
    },
    {
      event: 'complete',
      from: ['paused'],
      to: 'running',
      actors: ['system'],
      writers: [`${CP}#draft__activate_next`],
      note: 'A restored drop that empties the queue completes the pool, which clears the pause.',
    },
  ],
});

/**
 * The Redraft's submission window, derived and never stored: a pool in phase `submissions` is `open` until
 * `submission_deadline_at`, then `locked` (the snapshot's `redraft.phase = 'locked'`, `draft__build_snapshot`;
 * TS twin `isSubmissionLocked`, which also locks a pool without a deadline). redraft_set_submission refuses a locked
 * window with SUBMISSION_LOCKED. The window ends when the pool leaves `submissions` (draft_pool.phase).
 */
export const redraftSubmissionWindowMachine = defineMachine({
  id: 'redraft.submission_window',
  title: 'Redraft submission window',
  storage: "derived: draft_pools.phase = 'submissions' and submission_deadline_at vs now()",
  summary:
    "Players change their secret drops while the window is open. The lock is time, not a write, so the client (server-offset clock) and SQL (now()) can disagree for a moment; SQL decides. Moving the deadline into the future reopens a locked window.",
  doc: 'docs/draft-room.md',
  states: ['open', 'locked'],
  initial: ['open'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'lock',
      from: ['open'],
      to: 'locked',
      actors: ['system'],
      writers: [`${LG}#draft__build_snapshot`, `${LG}#redraft_set_submission`, 'src/lib/supabase/queries/drafts-redraft.ts'],
      note: 'The deadline passes (derived where it is read).',
    },
    {
      event: 'move_deadline',
      from: ['locked'],
      to: 'open',
      actors: ['admin'],
      writers: [`${LG}#draft_configure`, 'src/app/api/drafts/[id]/redraft/route.ts'],
      note: 'PATCH /api/drafts/[id]/redraft with a future deadline_at (submissions phase only).',
    },
  ],
});
