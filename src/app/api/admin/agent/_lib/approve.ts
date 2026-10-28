/**
 * Wires the executor for the approve and resume routes: the real store, the in-code binding registry (`_ops/g`), the live
 * precondition reads, the write limiter, the audit writer and the harness-event channel. This file and the two routes are
 * the only code that may import the executor; the chat route and everything it shares (`_lib/agent.ts`) must not reach it
 * (a module-graph test).
 *
 * The routes keep the request checks (live guard and audience, origin rule, path id, bounded body); everything after
 * "this is the admin's proposal" is the executor's, including the 404 for another admin's proposal.
 */
import { createHmac } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { afterFingerprintFor } from '@/lib/ai/admin-agent/proposals/after-state';
import { liveBeforeState, liveFingerprints } from '@/lib/ai/admin-agent/proposals/live';
import {
  executeProposal,
  ProposalExecutionError,
  type ApprovalInput,
  type ExecutorDeps,
  type ProposalResult,
} from '@/lib/ai/admin-agent/proposals/executor';
import { buildToolSet } from '@/lib/ai/admin-agent/registry';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import { logAuditEvent } from '@/lib/audit/log';
import { requireEnv } from '@/lib/env';
import { checkRateLimit, findClientIp } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';
import { getBindingRegistry } from '../_ops/g';
import type { AgentAuth } from './auth';
import { agentError } from './errors';
import { recordHarnessEvent } from './events';
import { agentRateLimited } from './request';

/** A keyed hash of the client address for the claim's stamp: the address itself is never stored. */
function hashClientIp(request: NextRequest): string | null {
  const ip = findClientIp(request);
  if (ip === null) return null;
  try {
    const secret = requireEnv('NEXTAUTH_SECRET');
    return createHmac('sha256', secret).update(`admin-agent/approval-ip/v1\n${ip}`).digest('hex');
  } catch (error) {
    // The stamp is evidence, not a gate: a missing secret must not block an approval that the token already authorised.
    console.error('[admin-agent] could not hash the approver address', error);
    return null;
  }
}

function liveDeps(auth: AgentAuth): ExecutorDeps {
  return {
    store: adminAgentStore,
    bindings: getBindingRegistry(),
    fingerprints: liveFingerprints,
    // The state each undoable step leaves, and the pins a move starts from: what a later `propose_undo` is built on.
    afterFingerprint: afterFingerprintFor(liveFingerprints),
    beforeState: liveBeforeState,
    config: () => auth.config,
    registryVersion: (toolSet) => buildToolSet({ role: toolSet === 'site' ? 'site' : 'scoped', maxPhase: auth.config.maxPhase }).registryVersion,
    rateLimit: (identity, options) => checkRateLimit('admin-agent-write', identity, { ...options, failMode: 'closed' }),
    recordEvent: recordHarnessEvent,
    audit: logAuditEvent,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

async function run(auth: AgentAuth, request: NextRequest, proposalId: string, approval: ApprovalInput | null): Promise<NextResponse> {
  // `authorizeAgent({ record: true })` returns the recorded session; the routes always ask for it.
  if (auth.session === null) throw agentError('agent_harness_error', 500);
  const base = {
    adminId: auth.adminId,
    adminName: auth.player.name,
    isSiteAdmin: auth.player.isAdmin,
    session: auth.session,
    inbound: request,
    proposalId,
  };
  try {
    const result = await executeProposal(liveDeps(auth), approval === null ? { ...base, mode: 'resume' } : { ...base, mode: 'approve', approval });
    return NextResponse.json<ApiResult<ProposalResult>>({ success: true, data: result });
  } catch (err) {
    // The limiter's refusal keeps the standard 429 with `Retry-After`; everything else goes to the route's safeErrorResponse.
    if (err instanceof ProposalExecutionError && err.retryAfterSeconds !== undefined) return agentRateLimited(err.retryAfterSeconds);
    throw err;
  }
}

export interface ApproveBody {
  readonly token: string;
  readonly proposal_hash: string;
  readonly preview_hash: string;
  readonly acks: readonly string[];
  readonly typed?: Readonly<Record<string, string>>;
}

/** `POST /proposals/[id]/approve`: claim, recheck and run. Answers the structured result (JSON, not a stream, in slice 1). */
export function approveProposal(options: { auth: AgentAuth; request: NextRequest; proposalId: string; body: ApproveBody }): Promise<NextResponse> {
  const { auth, request, proposalId, body } = options;
  return run(auth, request, proposalId, {
    token: body.token,
    proposalHash: body.proposal_hash,
    previewHash: body.preview_hash,
    acks: body.acks,
    ...(body.typed === undefined ? {} : { typed: body.typed }),
    ipHash: hashClientIp(request),
    userAgent: request.headers.get('user-agent'),
  });
}

/** `POST /proposals/[id]/resume`: continue a Build left `executing` within ten minutes, under the same approval. */
export function resumeProposal(options: { auth: AgentAuth; request: NextRequest; proposalId: string }): Promise<NextResponse> {
  return run(options.auth, options.request, options.proposalId, null);
}
