import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAnyAdmin: vi.fn(),
  authAndRecord: vi.fn(),
  checkRateLimit: vi.fn(),
  getCard: vi.fn(),
  getApprovalToken: vi.fn(),
  store: {
    conversations: { withTurnLease: vi.fn() },
    messages: { appendMessage: vi.fn(), loadTail: vi.fn() },
    proposals: { getProposalOrThrow: vi.fn(), declineProposal: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: mocks.requireAnyAdmin,
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth/session-override', () => ({ authAndRecord: mocks.authAndRecord }));
vi.mock('@/lib/ai/admin-agent/store', () => ({ adminAgentStore: mocks.store }));
vi.mock('@/lib/ai/admin-agent/proposals/serve', () => ({ getCard: mocks.getCard, getApprovalToken: mocks.getApprovalToken }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: mocks.checkRateLimit,
}));

import { AuthError } from '@/lib/auth/helpers';
import { AdminAgentStoreError } from '@/lib/ai/admin-agent/store/errors';
import * as detail from '../proposals/[id]/route';
import * as approve from '../proposals/[id]/approve/route';
import * as decline from '../proposals/[id]/decline/route';
import * as resume from '../proposals/[id]/resume/route';
import { CONVERSATION, ME, PROPOSAL, SAME_SITE, get, params, player, post, proposal } from './support';

const HEX = 'a'.repeat(64);
const APPROVE_BODY = { token: HEX, proposal_hash: HEX, preview_hash: HEX, acks: ['visible_publicly'] };
const base = `/api/admin/agent/proposals/${PROPOSAL}`;
const ctx = params({ id: PROPOSAL });

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('ADMIN_AGENT_ENABLED', 'true');
  // The route gate refuses a hosted database outside a production build; the suites run against mocks.
  vi.stubEnv('ADMIN_AGENT_ALLOW_HOSTED', 'true');
  mocks.requireAnyAdmin.mockResolvedValue(player());
  mocks.authAndRecord.mockResolvedValue({ expires: '2099-01-01T00:00:00.000Z' });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
  mocks.store.proposals.getProposalOrThrow.mockResolvedValue(proposal());
  mocks.store.conversations.withTurnLease.mockImplementation(async (_admin: string, _conversation: string, work: () => Promise<unknown>) => work());
  mocks.store.messages.appendMessage.mockResolvedValue({ message: {}, duplicate: false });
  mocks.store.messages.loadTail.mockResolvedValue([]);
});

describe('GET /api/admin/agent/proposals/[id]', () => {
  const card = { id: PROPOSAL, actionable: true, effectiveStatus: 'proposed', proposalHash: HEX, previewHash: HEX };

  it('delivers the card and, while it waits, the approval token to the owning admin, uncached', async () => {
    mocks.getCard.mockResolvedValue(card);
    mocks.getApprovalToken.mockResolvedValue('t'.repeat(64));
    const res = await detail.GET(get(base) as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: true, data: { card, token: 't'.repeat(64) } });
    expect(mocks.getCard).toHaveBeenCalledWith(PROPOSAL, ME);
    expect(mocks.getApprovalToken).toHaveBeenCalledWith(PROPOSAL, ME);
  });

  it('delivers no token for a card that no longer waits', async () => {
    mocks.getCard.mockResolvedValue({ ...card, actionable: false, effectiveStatus: 'declined' });
    const { data } = await (await detail.GET(get(base) as never, ctx)).json();
    expect(data.token).toBeNull();
    expect(mocks.getApprovalToken).not.toHaveBeenCalled();
  });

  it('answers 404 for another admin\'s proposal and never asks for its token', async () => {
    mocks.getCard.mockRejectedValue(new AdminAgentStoreError('proposal_not_found'));
    const res = await detail.GET(get(base) as never, ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('proposal_not_found');
    expect(mocks.getApprovalToken).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_PROPOSAL_ID for a malformed id before any read', async () => {
    const res = await detail.GET(get(`${base}x`) as never, params({ id: 'not-a-uuid' }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('INVALID_PROPOSAL_ID');
    expect(mocks.getCard).not.toHaveBeenCalled();
  });

  it('is closed to a non-admin and to an admin the assistant is off for', async () => {
    mocks.requireAnyAdmin.mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await detail.GET(get(base) as never, ctx)).status).toBe(403);
    mocks.requireAnyAdmin.mockResolvedValue(player());
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'false');
    expect((await detail.GET(get(base) as never, ctx)).status).toBe(404);
    expect(mocks.getCard).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/agent/proposals/[id]/approve (phase 0)', () => {
  const call = (body: unknown = APPROVE_BODY, headers?: Record<string, string>) => approve.POST(post(`${base}/approve`, body, headers) as never, ctx);

  it('answers 501 phase_disabled after the live guard, the origin rule, the body and the same-admin check', async () => {
    const res = await call();
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ success: false, code: 'phase_disabled' });
    expect(mocks.authAndRecord).toHaveBeenCalledOnce();
    expect(mocks.requireAnyAdmin).toHaveBeenCalled();
    expect(mocks.store.proposals.getProposalOrThrow).toHaveBeenCalledWith(ME, PROPOSAL);
  });

  it('claims nothing, writes nothing and charges nothing', async () => {
    await call();
    expect(mocks.store.proposals.declineProposal).not.toHaveBeenCalled();
    expect(mocks.store.messages.appendMessage).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it('answers 404 for another admin\'s proposal, not 501, so existence is not confirmed', async () => {
    mocks.store.proposals.getProposalOrThrow.mockRejectedValue(new AdminAgentStoreError('proposal_not_found'));
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('proposal_not_found');
  });

  it('is closed to a non-admin (403) and to an admin the assistant is off for (404)', async () => {
    mocks.requireAnyAdmin.mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await call()).status).toBe(403);
    mocks.requireAnyAdmin.mockResolvedValue(player());
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'false');
    expect((await call()).status).toBe(404);
    expect(mocks.store.proposals.getProposalOrThrow).not.toHaveBeenCalled();
  });

  it.each([
    ['no Origin', { 'content-type': 'application/json' }],
    ['a null Origin', { ...SAME_SITE, origin: 'null' }],
    ['a cross-site Origin', { ...SAME_SITE, origin: 'https://evil.example' }],
    ['Sec-Fetch-Site other than same-origin', { ...SAME_SITE, 'sec-fetch-site': 'cross-site' }],
  ])('refuses %s with 403', async (_name, headers) => {
    expect((await call(APPROVE_BODY, headers)).status).toBe(403);
    expect(mocks.store.proposals.getProposalOrThrow).not.toHaveBeenCalled();
  });

  it('refuses a malformed id, a non-JSON body, an oversized body and an invalid body before any read', async () => {
    expect((await approve.POST(post(`${base}x/approve`, APPROVE_BODY) as never, params({ id: 'nope' }))).status).toBe(404);
    expect((await call('{}', { ...SAME_SITE, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await call('{oops')).status).toBe(400);
    expect((await call({ ...APPROVE_BODY, pad: 'x'.repeat(20_000) })).status).toBe(413);
    for (const body of [{}, { ...APPROVE_BODY, token: 'short' }, { ...APPROVE_BODY, acks: 'yes' }, { ...APPROVE_BODY, extra: 1 }, { ...APPROVE_BODY, acks: Array(13).fill('a') }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(mocks.store.proposals.getProposalOrThrow).not.toHaveBeenCalled();
  });

  it('keeps its import graph clean: no executor, no dispatch, no loop', () => {
    const source = readFileSync(path.join(__dirname, '..', 'proposals', '[id]', 'approve', 'route.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.filter((specifier) => /executor|dispatch|\/loop|_ops|session-override|registry/.test(specifier))).toEqual([]);
  });
});

describe('POST /api/admin/agent/proposals/[id]/resume (phase 0)', () => {
  const call = (headers?: Record<string, string>) => resume.POST(post(`${base}/resume`, undefined, headers) as never, ctx);

  it('answers 501 phase_disabled for the owner and 404 for anyone else', async () => {
    expect((await call()).status).toBe(501);
    mocks.store.proposals.getProposalOrThrow.mockRejectedValue(new AdminAgentStoreError('proposal_not_found'));
    expect((await call()).status).toBe(404);
  });

  it('refuses a cross-site request and a non-admin', async () => {
    expect((await call({ 'content-type': 'application/json' })).status).toBe(403);
    mocks.requireAnyAdmin.mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await call()).status).toBe(403);
  });
});

describe('POST /api/admin/agent/proposals/[id]/decline', () => {
  const call = (headers?: Record<string, string>) => decline.POST(post(`${base}/decline`, undefined, headers) as never, ctx);
  const declined = () => proposal({ status: 'declined' });

  it('declines under the conversation\'s turn lease and tells the model with a harness event', async () => {
    mocks.store.proposals.declineProposal.mockResolvedValue(declined());
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { id: PROPOSAL, status: 'declined', effectiveStatus: 'declined', planCode: '01234567' } });

    expect(mocks.store.conversations.withTurnLease).toHaveBeenCalledWith(ME, CONVERSATION, expect.any(Function), 30);
    expect(mocks.store.proposals.declineProposal).toHaveBeenCalledWith(ME, PROPOSAL);
    const [admin, conversationId, event] = mocks.store.messages.appendMessage.mock.calls[0];
    expect([admin, conversationId]).toEqual([ME, CONVERSATION]);
    expect(event).toMatchObject({ role: 'system', kind: 'harness_event', ui: { event: 'proposal_declined', data: { proposal_id: PROPOSAL, plan_code: '01234567' } } });
    // The event is the only thing the model reads about a decline; it carries no token and no hash beyond the plan code.
    expect(JSON.stringify(event)).not.toContain(HEX);
  });

  it('answers the tool calls a cut-off turn left dangling before it writes the event (the history stays valid)', async () => {
    mocks.store.proposals.declineProposal.mockResolvedValue(declined());
    mocks.store.messages.loadTail.mockResolvedValue([
      { seq: 7, role: 'assistant', kind: 'chat', content: [{ type: 'text', text: 'Staging it.' }, { type: 'tool_use', id: 'toolu_x', name: 'propose_build', input: { plan_revision: 2 } }] },
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    const written = mocks.store.messages.appendMessage.mock.calls.map(([, , message]) => message);
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ role: 'user', kind: 'tool_results', ui: { repaired: true } });
    expect(JSON.parse(written[0].content[0].content)).toEqual({ ok: false, code: 'unknown_outcome' });
    expect(written[0].content[0].tool_use_id).toBe('toolu_x');
    expect(written[1]).toMatchObject({ role: 'system', kind: 'harness_event', ui: { event: 'proposal_declined' } });
  });

  it('does not decline while a turn is running: the lease is busy, nothing is written', async () => {
    mocks.store.conversations.withTurnLease.mockRejectedValue(new AdminAgentStoreError('agent_conversation_busy'));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('agent_conversation_busy');
    expect(mocks.store.proposals.declineProposal).not.toHaveBeenCalled();
    expect(mocks.store.messages.appendMessage).not.toHaveBeenCalled();
  });

  it('answers 409 proposal_not_pending for a proposal that was already handled, and appends no event', async () => {
    mocks.store.proposals.declineProposal.mockRejectedValue(new AdminAgentStoreError('proposal_not_pending'));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('proposal_not_pending');
    expect(mocks.store.messages.appendMessage).not.toHaveBeenCalled();
  });

  it('answers 404 for another admin\'s proposal before it takes any lease', async () => {
    mocks.store.proposals.getProposalOrThrow.mockRejectedValue(new AdminAgentStoreError('proposal_not_found'));
    expect((await call()).status).toBe(404);
    expect(mocks.store.conversations.withTurnLease).not.toHaveBeenCalled();
  });

  it('keeps the decline when the event cannot be written (the next turn lists the pending proposals again)', async () => {
    mocks.store.proposals.declineProposal.mockResolvedValue(declined());
    mocks.store.messages.appendMessage.mockRejectedValue(new Error('write failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call()).status).toBe(200);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('refuses a cross-site request, a malformed id, a non-admin and a spent limiter', async () => {
    expect((await call({ 'content-type': 'application/json' })).status).toBe(403);
    expect((await decline.POST(post(`${base}x/decline`) as never, params({ id: 'nope' }))).status).toBe(404);
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 9 });
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('admin-agent-decline', ME, expect.objectContaining({ failMode: 'closed' }));
    expect(mocks.store.conversations.withTurnLease).not.toHaveBeenCalled();
    mocks.requireAnyAdmin.mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await call()).status).toBe(403);
  });
});
