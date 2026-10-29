import { NextRequest, NextResponse } from 'next/server';
import type { ProposalDetail } from '@/components/admin/assistant/types';
import { getApprovalToken, getCard } from '@/lib/ai/admin-agent/proposals/serve';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import type { ApiResult } from '@/types/api';
import { authorizeAgent } from '../../_lib/auth';

/**
 * GET /api/admin/agent/proposals/[id]
 *
 * The frozen card of one of the signed-in admin's own proposals with its live status, and, while the proposal waits for
 * an answer, its approval token (plan 4.5): the token is delivered only here, only to the admin who staged it, never in
 * a message, a tool result or the stream. Another admin's proposal answers 404 `proposal_not_found`. The response is
 * never cached.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent();
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalid) return invalid;

    const card = await getCard(id, auth.adminId);
    const token = card.actionable ? await getApprovalToken(id, auth.adminId) : null;
    return NextResponse.json<ApiResult<ProposalDetail>>({ success: true, data: { card, token } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the proposal');
  }
}
