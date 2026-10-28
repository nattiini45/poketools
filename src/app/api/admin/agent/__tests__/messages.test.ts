import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAnyAdmin: vi.fn(),
  authAndRecord: vi.fn(),
  checkRateLimit: vi.fn(),
  startTurn: vi.fn(),
  after: vi.fn(),
  store: {
    conversations: { getConversation: vi.fn(), withTurnLease: vi.fn() },
    messages: { loadTail: vi.fn(), appendMessage: vi.fn() },
    proposals: { reapExecutingProposals: vi.fn(), getProposal: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: mocks.after }));
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
vi.mock('@/lib/ai/admin-agent/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/admin-agent/store')>()),
  adminAgentStore: mocks.store,
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock('../_lib/agent', () => ({ getAdminAgent: () => ({ startTurn: mocks.startTurn }) }));

import { AuthError } from '@/lib/auth/helpers';
import { AdminAgentStoreError } from '@/lib/ai/admin-agent/store/errors';
import * as route from '../conversations/[id]/messages/route';
import { REAPER_AGE_MS } from '@/lib/ai/admin-agent/proposals/reaper';
import { CONVERSATION, ME, SAME_SITE, conversation, message, params, player, post, proposal } from './support';

const URL = `/api/admin/agent/conversations/${CONVERSATION}/messages`;
/** The session `authAndRecord()` returns; the turn carries this very object (by reference) to the D tools. */
const SESSION = { expires: '2099-01-01T00:00:00.000Z' };
const GOOD = { text: 'Set up a 12-player league', client_msg_id: 'msg-12345678' };

function startedTurn(events = 'data: {"type":"done","reason":"completed","resumable":false}\n\n') {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(events));
      controller.close();
    },
  });
  return { stream, completion: Promise.resolve({ reason: 'completed' }) };
}

const call = (body: unknown, headers?: Record<string, string>) => route.POST(post(URL, body, headers) as never, params({ id: CONVERSATION }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('ADMIN_AGENT_ENABLED', 'true');
  // The route gate refuses a hosted database outside a production build; the suites run against mocks.
  vi.stubEnv('ADMIN_AGENT_ALLOW_HOSTED', 'true');
  mocks.requireAnyAdmin.mockResolvedValue(player());
  mocks.authAndRecord.mockResolvedValue(SESSION);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 30, retryAfterSeconds: 0 });
  mocks.store.conversations.getConversation.mockResolvedValue(conversation());
  mocks.store.proposals.reapExecutingProposals.mockResolvedValue([]);
  mocks.store.conversations.withTurnLease.mockImplementation(async (_admin: string, _conversation: string, work: () => Promise<unknown>) => work());
  mocks.startTurn.mockResolvedValue(startedTurn());
});

describe('POST /api/admin/agent/conversations/[id]/messages', () => {
  it('runs for the whole model loop: maxDuration is 300', () => {
    expect(route.maxDuration).toBe(300);
  });

  it('records the session, starts the turn for the live admin and hands the completion to after()', async () => {
    const started = startedTurn();
    mocks.startTurn.mockResolvedValue(started);
    const res = await call(GOOD, { ...SAME_SITE, cookie: 'plc_locale=de; plc_tz=America/New_York' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    expect(await res.text()).toContain('"type":"done"');
    expect(mocks.authAndRecord).toHaveBeenCalledOnce();
    expect(mocks.startTurn).toHaveBeenCalledWith({
      adminId: ME,
      adminName: 'Site Admin',
      conversationId: CONVERSATION,
      input: { kind: 'message', text: GOOD.text, clientMsgId: GOOD.client_msg_id },
      locale: 'de',
      timeZone: 'America/New_York',
      role: 'site',
      dispatch: { session: SESSION, inbound: expect.anything() },
    });
    expect(mocks.startTurn.mock.calls[0][0].dispatch.session).toBe(SESSION);
    // Spike S7: the loop outlives the connection because its completion is given to after().
    expect(mocks.after).toHaveBeenCalledWith(started.completion);
  });

  it('hands the recorded session and this request to the turn, for the D tools that run a route as this admin', async () => {
    await call(GOOD, { ...SAME_SITE, 'x-forwarded-for': '203.0.113.7' });
    const { dispatch } = mocks.startTurn.mock.calls[0][0];
    expect(dispatch.session).toBe(SESSION);
    expect(dispatch.inbound.headers.get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it('still runs the turn when no session was recorded: the dispatch is omitted, so only the D tools are cut off', async () => {
    mocks.authAndRecord.mockResolvedValue(null);
    const res = await call(GOOD);
    expect(res.status).toBe(200);
    expect(mocks.startTurn).toHaveBeenCalledOnce();
    expect(Object.keys(mocks.startTurn.mock.calls[0][0])).not.toContain('dispatch');
  });

  it('never wires the turn to the request: the start call carries no signal', async () => {
    await call(GOOD);
    expect(JSON.stringify(Object.keys(mocks.startTurn.mock.calls[0][0]))).not.toMatch(/signal|abort/i);
  });

  it('falls back to the default zone when the cookie is not a time zone', async () => {
    await call(GOOD, { ...SAME_SITE, cookie: 'plc_tz=Mars/Olympus' });
    expect(mocks.startTurn.mock.calls[0][0].timeZone).toBe('Europe/Berlin');
  });

  it('starts a continue turn only when a harness event waits', async () => {
    mocks.store.messages.loadTail.mockResolvedValue([message({ seq: 5, role: 'system', kind: 'harness_event' })]);
    const res = await call({ continue: true });
    expect(res.status).toBe(200);
    expect(mocks.startTurn.mock.calls[0][0].input).toEqual({ kind: 'continue' });
    expect(mocks.checkRateLimit).toHaveBeenCalled();
  });

  it('refuses a continue with nothing to continue, before the limiter is charged', async () => {
    mocks.store.messages.loadTail.mockResolvedValue([message({ seq: 5, role: 'assistant', kind: 'chat' })]);
    const res = await call({ continue: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });

  describe('refuses before any work', () => {
    it('a non-admin gets the guard\'s 403', async () => {
      mocks.requireAnyAdmin.mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
      expect((await call(GOOD)).status).toBe(403);
      expect(mocks.store.conversations.getConversation).not.toHaveBeenCalled();
    });

    it('the assistant being off is a plain 404', async () => {
      vi.stubEnv('ADMIN_AGENT_ENABLED', 'false');
      const res = await call(GOOD);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('agent_disabled');
      expect(mocks.startTurn).not.toHaveBeenCalled();
    });

    it.each([
      ['no origin', { 'content-type': 'application/json' }],
      ['a foreign origin', { ...SAME_SITE, origin: 'https://evil.example' }],
      ['a cross-site fetch', { ...SAME_SITE, 'sec-fetch-site': 'same-site' }],
    ])('%s is a 403', async (_name, headers) => {
      expect((await call(GOOD, headers)).status).toBe(403);
      expect(mocks.startTurn).not.toHaveBeenCalled();
    });

    it('a body that is not JSON, is too large or is malformed', async () => {
      expect((await call('{}', { ...SAME_SITE, 'content-type': 'text/plain' })).status).toBe(415);
      expect((await call('{broken')).status).toBe(400);
      expect((await call({ text: 'x'.repeat(100_000), client_msg_id: 'msg-12345678' })).status).toBe(413);
      expect((await call({ text: 'hi' })).status).toBe(400);
      expect((await call({ text: 'hi', client_msg_id: 'bad id!' })).status).toBe(400);
      expect((await call({ continue: false })).status).toBe(400);
      expect((await call({ ...GOOD, extra: 1 })).status).toBe(400);
      expect(mocks.store.conversations.getConversation).not.toHaveBeenCalled();
    });

    it('another admin\'s or an unknown conversation is a 404', async () => {
      mocks.store.conversations.getConversation.mockResolvedValue(null);
      const res = await call(GOOD);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('conversation_not_found');
      expect(mocks.store.conversations.getConversation).toHaveBeenCalledWith(ME, CONVERSATION);
      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    });

    it('a message over the character limit is a 413 with the limit, an empty one a 400', async () => {
      vi.stubEnv('ADMIN_AGENT_MAX_TEXT_CHARS', '200');
      const long = await call({ ...GOOD, text: 'é'.repeat(201) });
      expect(long.status).toBe(413);
      expect(await long.json()).toMatchObject({ code: 'agent_text_too_long', params: { max: 200 } });
      expect((await call({ ...GOOD, text: 'é'.repeat(200) })).status).toBe(200);
      expect((await call({ ...GOOD, text: '   ' })).status).toBe(400);
    });

    it('text with a webhook URL or a private field is text_not_allowed', async () => {
      const res = await call({ ...GOOD, text: 'post it to https://discord.com/api/webhooks/123456789/abcdefghijklmnop' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('text_not_allowed');
      expect(mocks.startTurn).not.toHaveBeenCalled();
      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    });
  });

  it('charges the turn limiter only after the request proved valid and the admin\'s own, failing closed', async () => {
    await call(GOOD);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('admin-agent-turn', ME, { limit: 40, windowSeconds: 3600, failMode: 'closed' });
    expect(mocks.checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.startTurn.mock.invocationCallOrder[0]);
    expect(mocks.checkRateLimit.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.store.conversations.getConversation.mock.invocationCallOrder[0]);
  });

  describe('the reaper', () => {
    it('reaps the overdue executions of the admin after the limiter and before the loop starts, and tells the conversation', async () => {
      mocks.store.proposals.reapExecutingProposals.mockResolvedValue([proposal().id]);
      mocks.store.proposals.getProposal.mockResolvedValue(proposal());
      mocks.store.messages.loadTail.mockResolvedValue([]);

      const before = Date.now();
      expect((await call(GOOD)).status).toBe(200);

      const [adminId, olderThan] = mocks.store.proposals.reapExecutingProposals.mock.calls[0] as [string, Date];
      expect(adminId).toBe(ME);
      expect(Math.abs(before - REAPER_AGE_MS - olderThan.getTime())).toBeLessThan(5000);
      expect(mocks.store.conversations.withTurnLease).toHaveBeenCalledWith(ME, CONVERSATION, expect.any(Function), 30);
      expect(mocks.store.messages.appendMessage).toHaveBeenCalledWith(
        ME,
        CONVERSATION,
        expect.objectContaining({ role: 'system', kind: 'harness_event', ui: { event: 'proposal_executed', data: expect.objectContaining({ proposal_id: proposal().id, status: 'unknown', reaped: true }) } }),
      );
      const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];
      expect(order(mocks.checkRateLimit)).toBeLessThan(order(mocks.store.proposals.reapExecutingProposals));
      expect(order(mocks.store.proposals.reapExecutingProposals)).toBeLessThan(order(mocks.store.conversations.withTurnLease));
      expect(order(mocks.store.conversations.withTurnLease)).toBeLessThan(order(mocks.startTurn));
    });

    it('also runs on a continue turn', async () => {
      mocks.store.messages.loadTail.mockResolvedValue([message({ seq: 5, role: 'system', kind: 'harness_event' })]);
      await call({ continue: true });
      expect(mocks.store.proposals.reapExecutingProposals).toHaveBeenCalledOnce();
    });

    it('does not run for a request that was refused (a conversation of another admin, a spent limit)', async () => {
      mocks.store.conversations.getConversation.mockResolvedValue(null);
      await call(GOOD);
      mocks.store.conversations.getConversation.mockResolvedValue(conversation());
      mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
      await call(GOOD);
      expect(mocks.store.proposals.reapExecutingProposals).not.toHaveBeenCalled();
    });

    it('never stops the turn: a failing reap is logged and the turn starts', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.store.proposals.reapExecutingProposals.mockRejectedValue(new Error('db down'));
      expect((await call(GOOD)).status).toBe(200);
      expect(mocks.startTurn).toHaveBeenCalledOnce();
      log.mockRestore();
    });
  });

  it('answers 429 with Retry-After and starts nothing when the limit is spent', async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const res = await call(GOOD);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(await res.json()).toMatchObject({ code: 'agent_rate_limited', params: { seconds: 30 } });
    expect(mocks.startTurn).not.toHaveBeenCalled();
  });

  it('answers 409 agent_conversation_busy when the turn lease is taken, and does not hand anything to after()', async () => {
    mocks.startTurn.mockRejectedValue(new AdminAgentStoreError('agent_conversation_busy'));
    const res = await call(GOOD);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'agent_conversation_busy' });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('answers 409 agent_admin_busy when another conversation of the admin has a turn running', async () => {
    mocks.startTurn.mockRejectedValue(new AdminAgentStoreError('agent_admin_busy'));
    expect(await (await call(GOOD)).json()).toMatchObject({ code: 'agent_admin_busy' });
  });

  it('turns a failure into a safe response: no internal message reaches the client', async () => {
    mocks.startTurn.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:5432 /var/secret/path'));
    const res = await call(GOOD);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|secret/);
  });
});
