import { NextRequest, NextResponse } from 'next/server';
import type { ProposalSummaryView } from '@/components/admin/assistant/types';
import { appendHarnessEvent } from '@/lib/ai/admin-agent/loop/repair';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { authorizeAgent } from '../../../_lib/auth';
import { agentRateLimited, assertSameOriginRequest } from '../../../_lib/request';
import { toProposalSummaryView } from '../../../_lib/views';

/** Declines per admin per hour; a decline writes a status and one message, so it is cheap but not free. */
const DECLINES_PER_HOUR = 120;
/** The lease is held only while the two writes run. */
const LEASE_SECONDS = 30;

/**
 * POST /api/admin/agent/proposals/[id]/decline
 *
 * Declines a proposal that still waits (nothing was executed, so there is nothing to undo) and tells the model through a
 * harness event; the UI then offers "Continue". The write runs under the conversation's turn lease: a harness event
 * appended while a turn is mid-step could land between a tool call and its result and break the history, so a decline
 * during a running turn answers 409 `agent_conversation_busy` and the card can be declined again a moment later.
 * Another admin's proposal is 404; one that was already handled is 409 `proposal_not_pending`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent();
    assertSameOriginRequest(request);
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalid) return invalid;

    const store = adminAgentStore;
    const proposal = await store.proposals.getProposalOrThrow(auth.adminId, id);

    const rate = await checkRateLimit('admin-agent-decline', auth.player.playerId, {
      limit: DECLINES_PER_HOUR,
      windowSeconds: 60 * 60,
      failMode: 'closed',
    });
    if (!rate.allowed) return agentRateLimited(rate.retryAfterSeconds);

    const declined = await store.conversations.withTurnLease(
      auth.adminId,
      proposal.conversation_id,
      async () => {
        const row = await store.proposals.declineProposal(auth.adminId, id);
        // The status is the record; the event only tells the model. A failed append is logged and the decline stands: the
        // next turn's state refresh lists the pending proposals again, so the model still learns of it.
        // A turn that was cut off between a tool call and its results is answered first (`appendHarnessEvent`): an event
        // between the two would make every later turn of the conversation a bad history.
        await appendHarnessEvent(store, auth.adminId, row.conversation_id, 'proposal_declined', { proposal_id: row.id, plan_code: row.proposal_hash.slice(0, 8) }).catch((error: unknown) =>
          console.error('[admin-agent] could not record the decline for the model', error),
        );
        return row;
      },
      LEASE_SECONDS,
    );

    return NextResponse.json<ApiResult<ProposalSummaryView>>({ success: true, data: toProposalSummaryView(declined, new Date()) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to decline the proposal');
  }
}
