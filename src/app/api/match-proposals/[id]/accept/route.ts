import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchById, updateMatchSchedule } from '@/lib/supabase/queries/matches';
import {
  acceptMatchProposal,
  cancelPendingMatchProposalsForMatch,
  expireMatchProposal,
  getMatchProposalById,
} from '@/lib/supabase/queries/match-proposals';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { MatchProposal } from '@/types/match-proposal';
import type { MatchWithPlayers } from '@/types/match';
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
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Only the responder can accept this proposal', code: 'match_proposal_accept_responder_only' }, { status: 403 });
    }
    if (proposal.status !== 'pending') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Proposal is no longer pending', code: 'match_proposal_not_pending' }, { status: 409 });
    }

    const now = new Date();
    if (new Date(proposal.expires_at) <= now) {
      await expireMatchProposal(id);
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Proposal has expired', code: 'match_proposal_expired' }, { status: 409 });
    }

    const match = await getMatchById(proposal.match_id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Match not found', code: 'match_not_found' }, { status: 404 });
    }
    if (match.status === 'completed' || match.status === 'disputed') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot schedule completed or disputed matches', code: 'match_schedule_closed' },
        { status: 409 }
      );
    }

    const accepted = await acceptMatchProposal(id);
    const updatedMatch = await updateMatchSchedule(proposal.match_id, proposal.proposed_at);
    await cancelPendingMatchProposalsForMatch(proposal.match_id);
    await revalidateMatchPages(match.tournament_id, match.id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.proposal.accept',
      resource_type: 'match',
      resource_id: proposal.match_id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      metadata: {
        proposal_id: proposal.id,
        scheduled_at: proposal.proposed_at,
      },
    });

    return NextResponse.json<ApiResult<{ proposal: MatchProposal; match: MatchWithPlayers }>>({
      success: true,
      data: { proposal: accepted, match: updatedMatch },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to accept match proposal');
  }
}