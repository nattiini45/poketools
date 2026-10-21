import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  createMatchProposal,
  getPendingProposalForParticipant,
  listMatchProposals,
} from '@/lib/supabase/queries/match-proposals';
import { matchProposalCreateSchema, formatZodErrors } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { MatchProposal, MatchProposalWithPlayers } from '@/types/match-proposal';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isMatchParticipant(playerId: string, match: { player_1_id: string; player_2_id: string }) {
  return playerId === match.player_1_id || playerId === match.player_2_id;
}

function getResponderId(playerId: string, match: { player_1_id: string; player_2_id: string }) {
  return playerId === match.player_1_id ? match.player_2_id : match.player_1_id;
}

const PROPOSAL_EXPIRY_MS = 48 * 60 * 60 * 1000;

function proposalExpiresAt(now: Date) {
  return new Date(now.getTime() + PROPOSAL_EXPIRY_MS).toISOString();
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_MATCH_ID');
    if (invalidId) return invalidId;

    const match = await getMatchById(id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Match not found', code: 'match_not_found' }, { status: 404 });
    }
    if (!isMatchParticipant(player.playerId, match)) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Match access required', code: 'match_access_required' }, { status: 403 });
    }

    const proposals = await listMatchProposals(id);
    return NextResponse.json<ApiResult<MatchProposalWithPlayers[]>>({ success: true, data: proposals });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load match proposals');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_MATCH_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json().catch(() => null);
    const zodResult = matchProposalCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const match = await getMatchById(id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Match not found', code: 'match_not_found' }, { status: 404 });
    }
    if (!isMatchParticipant(player.playerId, match)) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Only match participants can propose a time', code: 'match_proposal_participants_only' }, { status: 403 });
    }
    if (match.status === 'completed' || match.status === 'disputed') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot propose times for completed or disputed matches', code: 'match_proposal_match_closed' },
        { status: 409 }
      );
    }

    const proposedAt = new Date(zodResult.data.proposed_at);
    const now = new Date();
    if (proposedAt <= now) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Proposed time must be in the future', code: 'match_proposal_time_past' },
        { status: 400 }
      );
    }

    const responderId = getResponderId(player.playerId, match);
    const [proposerPending, responderPending] = await Promise.all([
      getPendingProposalForParticipant(id, player.playerId),
      getPendingProposalForParticipant(id, responderId),
    ]);
    if (proposerPending || responderPending) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'A pending proposal already exists for this match', code: 'match_proposal_pending_exists' },
        { status: 409 }
      );
    }

    const proposal = await createMatchProposal({
      match_id: id,
      proposer_id: player.playerId,
      responder_id: responderId,
      proposed_at: proposedAt.toISOString(),
      expires_at: proposalExpiresAt(now),
      message: zodResult.data.message,
    });

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.proposal.create',
      resource_type: 'match',
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      metadata: {
        proposal_id: proposal.id,
        proposed_at: proposal.proposed_at,
        responder_id: responderId,
      },
    });

    return NextResponse.json<ApiResult<MatchProposal>>({ success: true, data: proposal }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create match proposal');
  }
}
