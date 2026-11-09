import { defineMachine } from '@/lib/state-machine/machine';
import type { ProposalStatus } from './types';

/**
 * `admin_agent_proposals.status`: a hash-bound confirmation card from staging to its outcome (spec §18.6, plan 4.5).
 *
 * Every transition is one guarded UPDATE in `store/proposals.ts` (`.eq('status', from)` plus the admin, the token and
 * the clock for the claim). The guard trigger `admin_agent_proposals__guard` allows only the status changes listed here
 * (a raw UPDATE outside them raises ADMIN_AGENT_STATUS_REGRESS; `__tests__/state-machines.test.ts` holds the two equal), and
 * the partial unique index allows one `executing` proposal per conversation (`proposal_conflict_executing`). A Resume
 * continues the same claim and writes no status, so it is not a transition: a Build left `executing` (an unknown or
 * pending step) stays there until a Resume finishes it or the reaper ends it `unknown`.
 *
 * `expired` is derived on read (`effectiveProposalStatus`): a `proposed` row past `expires_at` shows as expired and
 * cannot be approved (the claim compares the clock); the stored value stays `proposed` because `expireProposals` has no
 * caller.
 */
export const proposalMachine = defineMachine({
  id: 'admin_agent_proposal',
  title: 'Admin Assistant proposal',
  storage: 'admin_agent_proposals.status',
  summary:
    'A staged confirmation card: approved (claimed) or declined by its admin, retired by a newer card or plan revision, then ended by the executor or the reaper. Stored expired is never written today: an overdue proposed row is shown as expired by effectiveProposalStatus.',
  doc: 'docs/poketools-spec.md',
  states: ['proposed', 'executing', 'completed', 'partial', 'failed', 'declined', 'expired', 'superseded', 'stale', 'unknown'],
  initial: ['proposed'],
  terminal: ['completed', 'partial', 'failed', 'declined', 'expired', 'superseded', 'stale', 'unknown'],
  actors: ['admin', 'system'],
  codes: { invalid: 'proposal_not_pending', forbidden: 'proposal_forbidden' },
  transitions: [
    {
      event: 'approve',
      from: ['proposed'],
      to: 'executing',
      actors: ['admin'],
      writers: ['src/lib/ai/admin-agent/store/proposals.ts', 'src/lib/ai/admin-agent/proposals/executor.ts'],
      note: 'claimProposal: one UPDATE bound to the admin, the token hash and an unexpired expires_at; stamps approved_by/at and executing_started_at.',
    },
    {
      event: 'decline',
      from: ['proposed'],
      to: 'declined',
      actors: ['admin'],
      writers: ['src/lib/ai/admin-agent/store/proposals.ts', 'src/app/api/admin/agent/proposals/[id]/decline/route.ts'],
      note: 'declineProposal stamps finished_at. It does not compare expires_at, so an overdue card can still be declined.',
    },
    {
      event: 'supersede',
      from: ['proposed'],
      to: 'superseded',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/proposals.ts', 'src/lib/ai/admin-agent/store/plans.ts'],
      note: 'Staging a card with the same supersede_key, or a plan revision retiring the Build cards of an older revision.',
    },
    {
      event: 'expire',
      from: ['proposed'],
      to: 'expired',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/proposals.ts'],
      note: 'expireProposals (overdue proposed rows of one admin). No caller today; readers derive expired with effectiveProposalStatus.',
    },
    {
      event: 'complete',
      from: ['executing'],
      to: 'completed',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/proposals/executor.ts', 'src/lib/ai/admin-agent/store/proposals.ts'],
      note: 'finishProposal after every step ended ok.',
    },
    {
      event: 'finish_partial',
      from: ['executing'],
      to: 'partial',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/proposals/executor.ts', 'src/lib/ai/admin-agent/store/proposals.ts'],
      note: 'Some steps ok, a later one failed or was skipped.',
    },
    {
      event: 'fail',
      from: ['executing'],
      to: 'failed',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/proposals/executor.ts', 'src/lib/ai/admin-agent/store/proposals.ts'],
      note: 'No step ok and one failed or was skipped, or the blast-radius counter was at its cap after the claim.',
    },
    {
      event: 'refuse_stale',
      from: ['executing'],
      to: 'stale',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/proposals/executor.ts', 'src/lib/ai/admin-agent/store/proposals.ts'],
      note: 'The recheck after the claim (hash, acknowledgements, registry, preconditions) or a stale precondition during the run; the claim is consumed.',
    },
    {
      event: 'lose_track',
      from: ['executing'],
      to: 'unknown',
      actors: ['system'],
      writers: [
        'src/lib/ai/admin-agent/proposals/executor.ts',
        'src/lib/ai/admin-agent/proposals/reaper.ts',
        'src/lib/ai/admin-agent/store/proposals.ts',
      ],
      note: 'A Go-live step with an unknown outcome, or the reaper (reapExecutingProposals) ending an execution older than the resume window plus one request.',
    },
  ],
});

/** Whether a proposal row may still be approved or declined from the card: `proposed` and not past `expires_at`. */
export function effectiveProposalStatus(row: { readonly status: ProposalStatus; readonly expires_at: string }, now: Date): ProposalStatus {
  return row.status === 'proposed' && new Date(row.expires_at).getTime() <= now.getTime() ? 'expired' : row.status;
}

/** Whether the card offers its admin an action (approve, decline): derived from the machine, never from a status list. */
export function isProposalActionable(effectiveStatus: ProposalStatus): boolean {
  return proposalMachine.transitionsFrom(effectiveStatus, 'admin').length > 0;
}
