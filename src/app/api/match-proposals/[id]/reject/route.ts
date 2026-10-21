import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  expireMatchProposal,
  getMatchProposalById,
  rejectMatchProposal,
} from '@/lib/supabase/queries/match-proposals';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { MatchProposal } from '@/types/match-proposal';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalidId) return invalidId;

    const proposal = await getMatchProposalById(id);
    if (!proposal) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Proposal not found', code: 'match_proposal_not_found' }, { status: 404 });
    }
    if (proposal.responder_id !== player.playerId) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Only the responder can reject this proposal', code: 'match_proposal_reject_responder_only' }, { status: 403 });
    }
    if (proposal.status !== 'pending') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Proposal is no longer pending', code: 'match_proposal_not_pending' }, { status: 409 });
    }

    if (new Date(proposal.expires_at) <= new Date()) {
      await expireMatchProposal(id);
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Proposal has expired', code: 'match_proposal_expired' }, { status: 409 });
    }

    const rejected = await rejectMatchProposal(id);
    const match = await getMatchById(proposal.match_id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.proposal.reject',
      resource_type: 'match',
      resource_id: proposal.match_id,
      resource_name: match ? `${match.player_1_name} vs ${match.player_2_name}` : undefined,
      metadata: {
        proposal_id: proposal.id,
        proposed_at: proposal.proposed_at,
      },
    });

    return NextResponse.json<ApiResult<MatchProposal>>({ success: true, data: rejected });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reject match proposal');
  }
}