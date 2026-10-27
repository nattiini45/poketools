import { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { authorizeAgent } from '../../../_lib/auth';
import { phaseDisabled } from '../../../_lib/errors';
import { assertSameOriginRequest, readAgentJson } from '../../../_lib/request';

/** The body is four short fields; 16 KiB is far above any honest request. */
const MAX_BODY_BYTES = 16 * 1024;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

const bodySchema = z.strictObject({
  token: sha256Hex,
  proposal_hash: sha256Hex,
  preview_hash: sha256Hex,
  /** The acknowledgement ids the card required, ticked by the admin. */
  acks: z.array(z.string().min(1).max(64)).max(12),
});

/**
 * POST /api/admin/agent/proposals/[id]/approve
 *
 * Phase 0: the route exists so the card and the client are complete, and it answers 501 `phase_disabled` after the same
 * checks the executing route will make first (spec §18.6 steps 1 and 2): the live `requireAnyAdmin` and the audience,
 * the browser-origin rule, the path id, the bounded body, and "the proposal is this admin's" (another admin's proposal
 * is 404, so existence is not confirmed). Nothing is claimed, nothing runs, nothing is written.
 *
 * Phase 1 continues here: live eligibility, the atomic claim, the binding and hash recheck, then the executor. This
 * module deliberately imports no executor.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent({ record: true });
    assertSameOriginRequest(request);
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalid) return invalid;
    await readAgentJson(request, bodySchema, MAX_BODY_BYTES);

    await adminAgentStore.proposals.getProposalOrThrow(auth.adminId, id);

    throw phaseDisabled();
  } catch (err) {
    return safeErrorResponse(err, 'Failed to approve the proposal');
  }
}
