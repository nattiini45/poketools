import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { Session } from 'next-auth';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { auth } from '@/auth';
import { getAgentAuditContext, type AgentAuditContext } from '@/lib/audit/agent-context';
import { authAndRecord, getVerifiedSession } from '@/lib/auth/session-override';
import { safeErrorResponse } from '@/lib/api/error-response';
import { invokeRoute } from '../invoke';
import { DEFAULT_ROUTE_TIMEOUT_MS, type DispatchContext, type RouteBinding, type RouteHandler } from '../types';

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn<() => Promise<Session | null>>>;

const ADMIN = '11111111-1111-4111-8111-111111111111';
const AUDIT: AgentAuditContext = {
  agent_conversation_id: 'conv-1',
  agent_proposal_id: 'prop-1',
  agent_step: 'league',
  approved_by: ADMIN,
  approved_at: '2026-10-27T10:00:00.000Z',
  plan_code: 'ab12cd34',
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    user: { id: ADMIN, name: 'Admin', email: 'admin@example.com', image: null },
    player: null,
    expires: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A session the way the chat and approve routes get one. */
async function recorded(overrides: Partial<Session> = {}): Promise<Session> {
  mockedAuth.mockResolvedValueOnce(makeSession(overrides));
  const session = await authAndRecord();
  if (session === null) throw new Error('expected a session');
  return session;
}

async function context(overrides: Partial<DispatchContext> = {}): Promise<DispatchContext> {
  return {
    session: await recorded(),
    inbound: { headers: new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9', 'x-real-ip': '198.51.100.9' }) },
    audit: AUDIT,
    ...overrides,
  };
}

function binding(handler: RouteHandler | undefined, overrides: Partial<RouteBinding> = {}): RouteBinding {
  return {
    operation: 'phase_create',
    method: 'POST',
    path: '/api/seasons/[id]/phases',
    class: 'D',
    load: async () => (handler === undefined ? {} : { [overrides.method ?? 'POST']: handler }),
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

beforeEach(() => {
  mockedAuth.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the synthetic request', () => {
  it('builds a NextRequest for a placeholder host with method, path, params, query and a JSON body', async () => {
    let seen: { url: URL; method: string; body: unknown; contentType: string | null; params: unknown } | undefined;
    const handler: RouteHandler = async (req: NextRequest, c: never) => {
      seen = {
        url: new URL(req.url),
        method: req.method,
        body: await req.json(),
        contentType: req.headers.get('content-type'),
        params: await (c as { params: Promise<unknown> }).params,
      };
      return json({ success: true, data: { id: 'p1' } }, 201);
    };

    const outcome = await invokeRoute(
      binding(handler),
      { params: { id: 'season/1 ü' }, query: { dry: true, tag: ['a', 'b'], skip: undefined, n: 3 }, body: { name: 'Group A' } },
      await context(),
    );

    expect(outcome).toMatchObject({ kind: 'ok', httpStatus: 201, data: { id: 'p1' } });
    expect(seen?.method).toBe('POST');
    expect(seen?.url.host).toBe('admin-agent.invalid');
    expect(seen?.url.pathname).toBe('/api/seasons/season%2F1%20%C3%BC/phases');
    expect(seen?.url.search).toBe('?dry=true&tag=a&tag=b&n=3');
    expect(seen?.body).toEqual({ name: 'Group A' });
    expect(seen?.contentType).toBe('application/json');
    // The handler gets the params as a promise of the raw (decoded) values.
    expect(seen?.params).toEqual({ id: 'season/1 ü' });
  });

  it('sends a bodyless GET without a content type', async () => {
    let contentType: string | null = 'unset';
    let method = '';
    const handler: RouteHandler = (req: NextRequest) => {
      contentType = req.headers.get('content-type');
      method = req.method;
      return json({ success: true, data: [] });
    };
    const outcome = await invokeRoute(
      binding(handler, { method: 'GET', class: 'R', path: '/api/seasons/me' }),
      {},
      await context(),
    );
    expect(outcome).toMatchObject({ kind: 'ok', data: [] });
    expect(method).toBe('GET');
    expect(contentType).toBeNull();
  });

  it('copies x-forwarded-for and x-real-ip from the inbound request and nothing else', async () => {
    let headers: Headers | undefined;
    let cookieCount = -1;
    const handler: RouteHandler = (req: NextRequest) => {
      headers = req.headers;
      cookieCount = req.cookies.getAll().length;
      return json({ success: true, data: null });
    };
    const ctx = await context({
      inbound: {
        headers: new Headers({
          'x-forwarded-for': '203.0.113.7, 198.51.100.9',
          'x-real-ip': '198.51.100.9',
          cookie: 'authjs.session-token=secret',
          authorization: 'Bearer secret',
          'user-agent': 'browser',
          origin: 'https://example.com',
          'x-vercel-forwarded-for': '10.0.0.1',
        }),
      },
    });
    await invokeRoute(binding(handler), { params: { id: 's1' }, body: {} }, ctx);

    expect(headers?.get('x-forwarded-for')).toBe('203.0.113.7, 198.51.100.9');
    expect(headers?.get('x-real-ip')).toBe('198.51.100.9');
    expect(headers?.get('cookie')).toBeNull();
    expect(headers?.get('authorization')).toBeNull();
    expect(headers?.get('user-agent')).toBeNull();
    expect(headers?.get('origin')).toBeNull();
    expect(headers?.get('x-vercel-forwarded-for')).toBeNull();
    expect(cookieCount).toBe(0);
  });

  it('copies only the header the inbound request has, and caps a huge value', async () => {
    const seen: Array<[string | null, string | null]> = [];
    const handler: RouteHandler = (req: NextRequest) => {
      seen.push([req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')]);
      return json({ success: true, data: null });
    };
    const b = binding(handler, { path: '/api/seasons', class: 'B' });
    await invokeRoute(b, {}, await context({ inbound: { headers: new Headers({ 'x-real-ip': '198.51.100.9' }) } }));
    await invokeRoute(b, {}, await context({ inbound: { headers: new Headers() } }));
    await invokeRoute(b, {}, await context({ inbound: { headers: new Headers({ 'x-forwarded-for': '1'.repeat(5000) }) } }));
    expect(seen[0]).toEqual([null, '198.51.100.9']);
    expect(seen[1]).toEqual([null, null]);
    expect(seen[2]?.[0]).toHaveLength(1024);
  });

  it('does not wire the request to an abort signal that can fire', async () => {
    let aborted: boolean | undefined;
    const handler: RouteHandler = (req: NextRequest) => {
      aborted = req.signal.aborted;
      return json({ success: true, data: null });
    };
    await invokeRoute(binding(handler, { path: '/api/seasons', class: 'B' }), {}, await context());
    expect(aborted).toBe(false);
  });
});

describe('identity and audit scope', () => {
  it('runs the handler as the recorded session and inside the agent audit context', async () => {
    const session = await recorded();
    let inside: { session: Session | undefined; audit: Readonly<AgentAuditContext> | undefined } | undefined;
    const handler: RouteHandler = async () => {
      // Still there after an await, as the route's audit calls come late.
      await Promise.resolve();
      inside = { session: getVerifiedSession(), audit: getAgentAuditContext() };
      return json({ success: true, data: null });
    };

    expect(getVerifiedSession()).toBeUndefined();
    expect(getAgentAuditContext()).toBeUndefined();
    await invokeRoute(binding(handler, { operation: 'phase_create' }), { params: { id: 's1' }, body: {} }, await context({ session }));

    expect(inside?.session).toBe(session);
    expect(inside?.audit).toEqual({ ...AUDIT, agent_tool: 'phase_create' });
    expect(Object.isFrozen(inside?.audit)).toBe(true);
    expect(getVerifiedSession()).toBeUndefined();
    expect(getAgentAuditContext()).toBeUndefined();
  });

  it('keeps an agent_tool the caller set', async () => {
    let tool: string | undefined;
    const handler: RouteHandler = () => {
      tool = getAgentAuditContext()?.agent_tool;
      return json({ success: true, data: null });
    };
    const ctx = await context({ audit: { ...AUDIT, agent_tool: 'propose_start_phase' } });
    await invokeRoute(binding(handler, { path: '/api/seasons', class: 'B' }), {}, ctx);
    expect(tool).toBe('propose_start_phase');
  });

  it('keeps concurrent dispatches apart', async () => {
    const seen: string[] = [];
    const handler: RouteHandler = async (req: NextRequest) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(`${getAgentAuditContext()?.agent_step}:${getVerifiedSession()?.user?.id}:${new URL(req.url).pathname}`);
      return json({ success: true, data: null });
    };
    const b = binding(handler);
    const a = await context({ audit: { ...AUDIT, agent_step: 'one' }, session: await recorded({ user: { id: 'u1', name: 'u1', email: 'u1@example.com', image: null } }) });
    const c = await context({ audit: { ...AUDIT, agent_step: 'two' }, session: await recorded({ user: { id: 'u2', name: 'u2', email: 'u2@example.com', image: null } }) });
    await Promise.all([invokeRoute(b, { params: { id: 'a' } }, a), invokeRoute(b, { params: { id: 'c' } }, c)]);
    expect(seen.sort()).toEqual(['one:u1:/api/seasons/a/phases', 'two:u2:/api/seasons/c/phases']);
  });
});

describe('session checks', () => {
  it('refuses an expired session before loading anything', async () => {
    const load = vi.fn(async () => ({ POST: () => json({ success: true, data: null }) }));
    const expired = await recorded({ expires: '2020-01-01T00:00:00.000Z' });
    const outcome = await invokeRoute(binding(undefined, { load }), { params: { id: 's1' } }, await context({ session: expired }));
    expect(outcome).toEqual({ kind: 'unauthenticated', httpStatus: 401, code: 'unauthenticated', sessionExpired: true });
    expect(load).not.toHaveBeenCalled();
  });

  it('checks expiry on every dispatch, not once per session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:00.000Z'));
    const handler = vi.fn(() => json({ success: true, data: null }));
    const session = await recorded({ expires: '2026-10-27T10:30:00.000Z' });
    const ctx = await context({ session });
    const b = binding(handler as unknown as RouteHandler, { path: '/api/seasons', class: 'B' });

    expect(await invokeRoute(b, {}, ctx)).toMatchObject({ kind: 'ok' });
    vi.setSystemTime(new Date('2026-10-27T10:31:00.000Z'));
    expect(await invokeRoute(b, {}, ctx)).toMatchObject({ kind: 'unauthenticated', sessionExpired: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable expires as expired', async () => {
    const session = await recorded({ expires: 'soon' });
    const outcome = await invokeRoute(binding(() => json({ success: true, data: null })), { params: { id: 's' } }, await context({ session }));
    expect(outcome).toMatchObject({ kind: 'unauthenticated', sessionExpired: true });
  });

  it('refuses a session auth() did not return, without running the handler', async () => {
    const handler = vi.fn(() => json({ success: true, data: null }));
    const forged = makeSession();
    const outcome = await invokeRoute(binding(handler as unknown as RouteHandler), { params: { id: 's1' }, body: {} }, await context({ session: forged }));
    expect(outcome).toEqual({ kind: 'harness_error', httpStatus: null, code: 'agent_harness_error', reason: 'session_refused', unknownOutcome: false });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('harness failures', () => {
  it('answers harness_error when the module does not load, without leaking the message', async () => {
    const load = vi.fn(async () => {
      throw new Error('Cannot find module secret-path');
    });
    const outcome = await invokeRoute(binding(undefined, { load }), { params: { id: 's1' } }, await context());
    expect(outcome).toMatchObject({ kind: 'harness_error', reason: 'load_failed', code: 'agent_harness_error', unknownOutcome: false });
    expect(JSON.stringify(outcome)).not.toContain('secret-path');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[admin-agent] dispatch phase_create: load_failed'), expect.any(Error));
  });

  it('answers harness_error when the module has no handler for the method', async () => {
    const outcome = await invokeRoute(binding(undefined), { params: { id: 's1' } }, await context());
    expect(outcome).toMatchObject({ kind: 'harness_error', reason: 'no_handler', unknownOutcome: false });
  });

  it('answers harness_error, unknown for a write, when the handler throws, and never carries err.message', async () => {
    const handler: RouteHandler = () => {
      throw new Error('select * from players: password=hunter2');
    };
    const write = await invokeRoute(binding(handler), { params: { id: 's1' } }, await context());
    expect(write).toMatchObject({ kind: 'harness_error', reason: 'handler_threw', code: 'agent_harness_error', unknownOutcome: true });
    expect(JSON.stringify(write)).not.toContain('hunter2');

    const read = await invokeRoute(binding(handler, { method: 'GET', class: 'R' }), { params: { id: 's1' } }, await context());
    expect(read).toMatchObject({ kind: 'harness_error', reason: 'handler_threw', unknownOutcome: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('handler_threw'), expect.objectContaining({ message: expect.stringContaining('hunter2') }));
  });

  it('answers harness_error when the handler returns something that is not a Response', async () => {
    const handler = (() => ({ success: true })) as unknown as RouteHandler;
    const outcome = await invokeRoute(binding(handler), { params: { id: 's1' } }, await context());
    expect(outcome).toMatchObject({ kind: 'harness_error', reason: 'bad_response', unknownOutcome: true });
  });

  it.each([
    ['a missing placeholder', {}],
    ['an extra param', { id: 's1', other: 'x' }],
    ['a wrong name', { season: 's1' }],
    ['an empty value', { id: '' }],
    ['a dot-dot value', { id: '..' }],
    ['a dot value', { id: '.' }],
  ])('refuses %s without running the handler', async (_name, params) => {
    const handler = vi.fn(() => json({ success: true, data: null }));
    const outcome = await invokeRoute(binding(handler as unknown as RouteHandler), { params }, await context());
    expect(outcome).toMatchObject({ kind: 'harness_error', reason: 'bad_params', unknownOutcome: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a body on GET and a body that cannot be serialised', async () => {
    const handler = vi.fn(() => json({ success: true, data: null }));
    const get = binding(handler as unknown as RouteHandler, { method: 'GET', class: 'R', path: '/api/seasons/me' });
    expect(await invokeRoute(get, { body: {} }, await context())).toMatchObject({ reason: 'bad_input' });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const post = binding(handler as unknown as RouteHandler, { path: '/api/seasons', class: 'B' });
    expect(await invokeRoute(post, { body: circular }, await context())).toMatchObject({ reason: 'bad_input' });
    expect(await invokeRoute(post, { body: 'x'.repeat(1_100_000) }, await context())).toMatchObject({ reason: 'bad_input' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('response mapping through the real error helper', () => {
  const post = (handler: RouteHandler) => binding(handler, { path: '/api/seasons', class: 'B' });

  it('maps a masked 500 of safeErrorResponse to an unknown outcome', async () => {
    const handler: RouteHandler = () => safeErrorResponse(new Error('db exploded: row 42'), 'Failed to create league');
    const outcome = await invokeRoute(post(handler), {}, await context());
    expect(outcome).toMatchObject({ kind: 'masked_server_error', httpStatus: 500, unknownOutcome: true, code: 'unknown_outcome' });
    expect(JSON.stringify(outcome)).not.toContain('db exploded');
    expect(JSON.stringify(outcome)).not.toContain('Failed to create league');
  });

  it('maps a Supabase deadline of safeErrorResponse (504) to upstream_timeout', async () => {
    const handler: RouteHandler = () => json({ success: false, error: 'Failed', code: 'upstream_timeout' }, 504);
    expect(await invokeRoute(post(handler), {}, await context())).toMatchObject({ kind: 'upstream_timeout', unknownOutcome: true });
    const get = binding(handler, { method: 'GET', class: 'R', path: '/api/seasons/me' });
    expect(await invokeRoute(get, {}, await context())).toMatchObject({ kind: 'upstream_timeout', unknownOutcome: false });
  });

  it('maps a 429 with Retry-After', async () => {
    const handler: RouteHandler = () =>
      NextResponse.json({ success: false, error: 'slow down', code: 'rate_limited', params: { seconds: 42 } }, { status: 429, headers: { 'Retry-After': '42' } });
    expect(await invokeRoute(post(handler), {}, await context())).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 42 });
  });

  it('maps an empty non-JSON error body by status alone', async () => {
    const handler: RouteHandler = () => new Response('<html>Bad gateway</html>', { status: 502 });
    expect(await invokeRoute(post(handler), {}, await context())).toMatchObject({ kind: 'masked_server_error', httpStatus: 502, unknownOutcome: true });
  });

  it('maps a 204 to ok with no data', async () => {
    const handler: RouteHandler = () => new Response(null, { status: 204 });
    expect(await invokeRoute(post(handler), {}, await context())).toMatchObject({ kind: 'ok', httpStatus: 204, data: undefined });
  });
});

describe('step timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const never: RouteHandler = () => new Promise<Response>(() => {});

  it('times a write out at the default 55 s as an unknown outcome', async () => {
    expect(DEFAULT_ROUTE_TIMEOUT_MS).toBe(55_000);
    const ctx = await context();
    let settled = false;
    const pending = invokeRoute(binding(never, { class: 'B', path: '/api/seasons' }), {}, ctx).then((outcome) => {
      settled = true;
      return outcome;
    });

    await vi.advanceTimersByTimeAsync(54_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;

    expect(outcome).toEqual({ kind: 'harness_error', httpStatus: null, code: 'unknown_outcome', reason: 'step_timeout', unknownOutcome: true });
  });

  it('times a read out as upstream_timeout, not an unknown outcome', async () => {
    const pending = invokeRoute(binding(never, { method: 'GET', class: 'R', path: '/api/seasons/me' }), {}, await context());
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await pending).toMatchObject({ kind: 'harness_error', reason: 'step_timeout', code: 'upstream_timeout', unknownOutcome: false });
  });

  it('honours the per-binding timeout (the league_trash case: roughly maxDuration minus a margin)', async () => {
    const pending = invokeRoute(binding(never, { timeoutMs: 280_000, class: 'G', path: '/api/seasons/[id]' }), { params: { id: 's' } }, await context());
    let done = false;
    void pending.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(279_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ reason: 'step_timeout', unknownOutcome: true });
  });

  it('does not time out a call that finishes in time, and leaves no timer behind', async () => {
    const handler: RouteHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return json({ success: true, data: { done: true } });
    };
    const pending = invokeRoute(binding(handler, { class: 'B', path: '/api/seasons' }), {}, await context());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ kind: 'ok', data: { done: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is not an unknown outcome when the deadline hits while the module is still loading', async () => {
    const load = () => new Promise<never>(() => {});
    const pending = invokeRoute(binding(undefined, { load, class: 'B', path: '/api/seasons' }), {}, await context());
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await pending).toMatchObject({ reason: 'step_timeout', code: 'upstream_timeout', unknownOutcome: false });
  });

  it('survives a handler that finishes, or fails, after the timeout, and logs how it ended', async () => {
    let finish: (response: Response) => void = () => {};
    const slow: RouteHandler = () => new Promise<Response>((resolve) => (finish = resolve));
    const pending = invokeRoute(binding(slow, { class: 'B', path: '/api/seasons' }), {}, await context());
    await vi.advanceTimersByTimeAsync(55_000);
    expect(await pending).toMatchObject({ reason: 'step_timeout' });

    finish(json({ success: true, data: { late: true } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('finished after its step timeout (status 200)'));

    const failing: RouteHandler = () => new Promise<Response>((_resolve, reject) => setTimeout(() => reject(new Error('late boom')), 60_000));
    const pending2 = invokeRoute(binding(failing, { class: 'B', path: '/api/seasons' }), {}, await context());
    await vi.advanceTimersByTimeAsync(55_000);
    await pending2;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('finished after its step timeout (handler_threw)'));
  });
});
