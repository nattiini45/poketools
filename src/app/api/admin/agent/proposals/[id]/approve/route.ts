import { NextRequest } from 'next/server';
import { z } from 'zod';
import { TYPED_NAME_WIRE_MAX } from '@/lib/ai/admin-agent/proposals/text';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { approveProposal } from '../../../_lib/approve';
import { authorizeAgent } from '../../../_lib/auth';
import { assertSameOriginRequest, readAgentJson } from '../../../_lib/request';

/** An approve runs the whole Build in this request; the executor stops starting steps after 225 s (spec §18.6). */
export const maxDuration = 300;

/** The body is four short fields; 16 KiB is far above any honest request. */
const MAX_BODY_BYTES = 16 * 1024;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

const bodySchema = z.strictObject({
  token: sha256Hex,
  proposal_hash: sha256Hex,
  preview_hash: sha256Hex,
  /** The acknowledgement ids the card required, ticked by the admin. */
  acks: z.array(z.string().min(1).max(64)).max(12),
  /** What the admin typed for each typed-name acknowledgement of the card, by acknowledgement id (the executor compares it with the card). */
  typed: z
    .record(z.string().min(1).max(64), z.string().max(TYPED_NAME_WIRE_MAX))
    .refine((value) => Object.keys(value).length <= 4)
    .optional(),
});

/**
 * POST /api/admin/agent/proposals/[id]/approve
 *
 * The first checks are the request's (spec §18.6 steps 1 and 2): the live `requireAnyAdmin` and the audience, the
 * browser-origin rule, the path id and the bounded body. Everything after that is the executor's (`_lib/approve.ts`): "the
 * proposal is this admin's" (another admin's is 404, so existence is not confirmed), the live eligibility, the atomic claim,
 * the binding and hash recheck, and the steps. The answer is the structured result as JSON (not a stream, in this slice).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAgent({ record: true });
    assertSameOriginRequest(request);
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_PROPOSAL_ID');
    if (invalid) return invalid;
    const body = await readAgentJson(request, bodySchema, MAX_BODY_BYTES);

    return await approveProposal({ auth, request, proposalId: id, body });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to approve the proposal');
  }
}
