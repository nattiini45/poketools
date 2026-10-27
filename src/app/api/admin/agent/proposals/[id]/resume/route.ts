import { NextRequest } from 'next/server';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { authorizeAgent } from '../../../_lib/auth';
import { phaseDisabled } from '../../../_lib/errors';
import { assertSameOriginRequest } from '../../../_lib/request';

/**
 * POST /api/admin/agent/proposals/[id]/resume
 *
 * Resumes a Build left `executing` within 10 minutes under the same approval (spec §18.6; a Go-live proposal never
 * resumes). Phase 0 executes nothing, so after the live guard, the origin rule, the path id and the same-admin check
 * (another admin's proposal is 404) this answers 501 `phase_disabled`. The body is empty.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent({ record: true });
    assertSameOriginRequest(request);
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalid) return invalid;
    await adminAgentStore.proposals.getProposalOrThrow(auth.adminId, id);

    throw phaseDisabled();
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resume the proposal');
  }
}
