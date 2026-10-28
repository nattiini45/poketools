import { NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { resumeProposal } from '../../../_lib/approve';
import { authorizeAgent } from '../../../_lib/auth';
import { assertSameOriginRequest } from '../../../_lib/request';

/** Like approve, a resume runs steps in this request. */
export const maxDuration = 300;

/**
 * POST /api/admin/agent/proposals/[id]/resume
 *
 * Resumes a Build left `executing` within 10 minutes under the same approval (spec §18.6; a Go-live proposal never
 * resumes, `409 proposal_not_resumable`). After the live guard, the origin rule and the path id the executor repeats the
 * live checks and the binding recheck, reconciles any step whose outcome was unknown, and continues after the last `ok`
 * step. The body is empty. Another admin's proposal is 404.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent({ record: true });
    assertSameOriginRequest(request);
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalid) return invalid;

    return await resumeProposal({ auth, request, proposalId: id });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resume the proposal');
  }
}
