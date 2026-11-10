import { defineMachine } from '@/lib/state-machine/machine';
import type { MatchProposal } from '@/types/match-proposal';

/**
 * A time proposal between the two players of a match (`match_proposals.status`). Every answer is a guarded UPDATE
 * `WHERE status = 'pending'` that stamps `responded_at` (the table's CHECK ties the two together), so a proposal is
 * answered once. A pending proposal past its `expires_at` is expired in effect (`effectiveProposalStatus`) before
 * the row says so.
 */
export const matchProposalMachine = defineMachine({
  id: 'match_proposal',
  title: 'Match proposal',
  storage: 'match_proposals.status (enum match_proposal_status) with expires_at',
  summary:
    'A time one player proposes and the other answers within 48 h. A pending proposal past expires_at counts as expired: it can no longer be answered, and the row is moved to expired when its responder answers it or when a new proposal is made for the match. Accepting it schedules the match and cancels the other pending proposals.',
  doc: 'docs/match.md',
  states: ['pending', 'accepted', 'rejected', 'expired', 'cancelled'],
  initial: ['pending'],
  terminal: ['accepted', 'rejected', 'expired', 'cancelled'],
  actors: ['responder', 'admin', 'system'],
  codes: { invalid: 'match_proposal_not_pending' },
  transitions: [
    {
      event: 'accept',
      from: ['pending'],
      to: 'accepted',
      actors: ['responder'],
      writers: ['src/app/api/match-proposals/[id]/accept/route.ts', 'src/lib/supabase/queries/match-proposals.ts'],
      note: 'The responder accepts before expires_at; the match is scheduled at the proposed time.',
    },
    {
      event: 'reject',
      from: ['pending'],
      to: 'rejected',
      actors: ['responder'],
      writers: ['src/app/api/match-proposals/[id]/reject/route.ts', 'src/lib/supabase/queries/match-proposals.ts'],
    },
    {
      event: 'expire',
      from: ['pending'],
      to: 'expired',
      actors: ['system'],
      writers: [
        'src/app/api/match-proposals/[id]/accept/route.ts',
        'src/app/api/match-proposals/[id]/reject/route.ts',
        'src/app/api/matches/[id]/proposals/route.ts',
        'src/lib/supabase/queries/match-proposals.ts',
      ],
      note: 'Lazily, once expires_at has passed: when the responder answers it, or before a new proposal for the match.',
    },
    {
      event: 'cancel',
      from: ['pending'],
      to: 'cancelled',
      actors: ['admin', 'system'],
      writers: [
        'src/app/api/match-proposals/[id]/accept/route.ts',
        'src/app/api/admin/matches/[id]/schedule/route.ts',
        'src/app/api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair/route.ts',
        'src/lib/match/bulk-actions.ts',
        'src/lib/season/substitute.ts',
        'src/lib/supabase/queries/match-proposals.ts',
      ],
      note: 'The match was scheduled another way (another proposal accepted, an admin schedule, a repair, a bulk action, a substitution).',
    },
  ],
});

export type MatchProposalState = (typeof matchProposalMachine.spec.states)[number];

/** The status a proposal has in effect at `now` (ms): a pending one past its expiry is expired. */
export function effectiveProposalStatus(
  proposal: Pick<MatchProposal, 'status' | 'expires_at'>,
  now: number,
): MatchProposal['status'] {
  return proposal.status === 'pending' && new Date(proposal.expires_at).getTime() <= now ? 'expired' : proposal.status;
}
