import { defineMachine } from '@/lib/state-machine/machine';

/**
 * `admin_agent_actions.status`: one ledger row per dispatched write (spec §18.7, "no ledger, no write").
 *
 * A row is inserted `executing` before the dispatch (the unique keys give at-most-once), then completed exactly once
 * with the outcome by `completeAction`, whose UPDATE is guarded with `.in('status', actionMachine.sourcesOf(to))`. A
 * Resume reconciles an `executing` row a crashed request left behind, or an `unknown` one, by reading the resource
 * back. The guard trigger `admin_agent_actions__guard` blocks every move back to `executing` and a move to `undone` from
 * anything but `ok` (or `undone`).
 */
export const actionMachine = defineMachine({
  id: 'admin_agent_action',
  title: 'Admin Assistant ledger row',
  storage: 'admin_agent_actions.status',
  summary:
    'A dispatched write of the assistant: inserted executing before the dispatch, completed once with its outcome, reconciled from unknown by a Resume, and marked undone after an undo proposal reversed it.',
  doc: 'docs/poketools-spec.md',
  states: ['executing', 'ok', 'failed', 'unknown', 'skipped', 'undone'],
  initial: ['executing'],
  terminal: ['failed', 'skipped', 'undone'],
  actors: ['system'],
  transitions: [
    {
      event: 'succeed',
      from: ['executing', 'unknown'],
      to: 'ok',
      actors: ['system'],
      writers: [
        'src/lib/ai/admin-agent/proposals/executor.ts',
        'src/lib/ai/admin-agent/staged/draft-tools.ts',
        'src/lib/ai/admin-agent/store/actions.ts',
      ],
      note: 'The route answered with the write, or a read-back confirmed it (a Resume reconciling an executing or unknown row).',
    },
    {
      event: 'fail',
      from: ['executing', 'unknown'],
      to: 'failed',
      actors: ['system'],
      writers: [
        'src/lib/ai/admin-agent/proposals/executor.ts',
        'src/lib/ai/admin-agent/staged/draft-tools.ts',
        'src/lib/ai/admin-agent/store/actions.ts',
      ],
      note: 'The route refused, or the read-back found the write and still a failure (created_but_unadministrable).',
    },
    {
      event: 'lose_track',
      from: ['executing', 'unknown'],
      to: 'unknown',
      actors: ['system'],
      writers: [
        'src/lib/ai/admin-agent/proposals/executor.ts',
        'src/lib/ai/admin-agent/staged/draft-tools.ts',
        'src/lib/ai/admin-agent/store/actions.ts',
      ],
      note: 'The answer did not arrive and the read-back cannot tell (a Resume may write unknown again with the new verify).',
    },
    {
      event: 'skip',
      from: ['executing'],
      to: 'skipped',
      actors: ['system'],
      writers: [
        'src/lib/ai/admin-agent/proposals/executor.ts',
        'src/lib/ai/admin-agent/staged/draft-tools.ts',
        'src/lib/ai/admin-agent/store/actions.ts',
      ],
      note: 'Not dispatched: a stale or unreadable precondition, a failed dependency, a call that no longer fits its binding, or a step after the run stopped (inserted and completed at once).',
    },
    {
      event: 'undo',
      from: ['ok'],
      to: 'undone',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/proposals/executor.ts', 'src/lib/ai/admin-agent/store/actions.ts'],
      note: 'markUndone after an undo proposal whose steps for this row all ended ok.',
    },
  ],
});
