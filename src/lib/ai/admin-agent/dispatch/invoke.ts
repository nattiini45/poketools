import 'server-only';
/**
 * Route-faithful dispatch (plan 3.3): runs an existing route handler in-process, as the admin whose session the
 * current request carries, and answers a typed `Outcome`.
 *
 * - The request is a `NextRequest` for a placeholder host. `x-forwarded-for` and `x-real-ip` are copied from the
 *   inbound request (`findClientIp` takes the last forwarded hop and falls back to `x-real-ip`; copying only one would
 *   read `unknown` for IP limiters). No cookie and no authorization header is ever set.
 * - The handler runs inside `runAsVerifiedSession(session)` (the only caller allowed to import it, a static test
 *   enforces that) and inside the agent audit context (plan 6.5), so the route's own `logAuditEvent` calls carry the
 *   conversation, proposal, step and approver.
 * - `session.expires` is checked before the call; an expired session is `unauthenticated` and nothing runs.
 * - A per-binding timeout (default 55 s) races the handler. A `Promise.race` cannot cancel an in-process handler: a
 *   timed-out write is `unknownOutcome`, may still be running, and is never retried by this module. The call is
 *   deliberately NOT wired to the inbound `request.signal` or to a stream cancel (spike S7): a closed tab must not
 *   abort a write half way.
 * - Failures of the harness itself (the module does not load, the session is refused, the handler throws) are
 *   `harness_error` with a catalogued code. `err.message` goes to the server log under `[admin-agent]`, never to the
 *   result.
 *
 * The module is generic: it imports no route. The binding's `load()` does, lazily.
 */
import { NextRequest } from 'next/server';
import { runWithAgentAuditContext } from '@/lib/audit/agent-context';
import { runAsVerifiedSession } from '@/lib/auth/session-override';
import { pathParamNames } from './binding';
import { harnessError, mapRouteResponse, parseBody } from './outcome';
import {
  DEFAULT_ROUTE_TIMEOUT_MS,
  type DispatchContext,
  type DispatchInput,
  type HarnessErrorReason,
  type Outcome,
  type RouteBinding,
} from './types';

/** Placeholder origin of the synthetic request. `.invalid` is reserved (RFC 2606): it can never resolve. */
const PLACEHOLDER_ORIGIN = 'http://admin-agent.invalid';
const COPIED_HEADERS = ['x-forwarded-for', 'x-real-ip'] as const;
const MAX_COPIED_HEADER_CHARS = 1024;
const MAX_BODY_CHARS = 1_000_000;
/** Larger bodies are not parsed (the result is `undefined`): bounded memory for a malformed route. */
const MAX_RESPONSE_CHARS = 8_000_000;

interface RawResponse {
  readonly status: number;
  readonly text: string;
  readonly retryAfter: string | null;
}

type StepResult =
  | { readonly ok: true; readonly raw: RawResponse }
  | { readonly ok: false; readonly reason: HarnessErrorReason; readonly error?: unknown; /** Handler code may have run. */ readonly ran: boolean };

function isUnexpired(expires: string | undefined): boolean {
  if (typeof expires !== 'string') return false;
  const at = Date.parse(expires);
  return Number.isFinite(at) && at > Date.now();
}

function isResponseLike(value: unknown): value is Response {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Response).status === 'number' &&
    typeof (value as Response).text === 'function' &&
    typeof (value as Response).headers?.get === 'function'
  );
}

/** The synthetic URL for a path pattern, or `null` when a placeholder has no usable value (or one too many is given). */
function buildUrl(binding: RouteBinding, input: DispatchInput): URL | null {
  const names = pathParamNames(binding.path);
  const given = input.params ?? {};
  const givenNames = Object.keys(given);
  if (givenNames.length !== names.length || !names.every((name) => Object.prototype.hasOwnProperty.call(given, name))) {
    return null;
  }
  let path = binding.path;
  for (const name of names) {
    const value = given[name];
    // An empty value or a dot segment would change the path the route sees (the URL parser resolves `..`).
    if (typeof value !== 'string' || value === '' || value === '.' || value === '..') return null;
    path = path.replace(`[${name}]`, encodeURIComponent(value));
  }
  const url = new URL(path, PLACEHOLDER_ORIGIN);
  for (const [key, raw] of Object.entries(input.query ?? {})) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
  }
  return url;
}

function buildRequest(binding: RouteBinding, input: DispatchInput, ctx: DispatchContext): NextRequest | HarnessErrorReason {
  const url = buildUrl(binding, input);
  if (url === null) return 'bad_params';

  const headers = new Headers({ accept: 'application/json' });
  for (const name of COPIED_HEADERS) {
    const value = ctx.inbound.headers.get(name);
    if (value) headers.set(name, value.slice(0, MAX_COPIED_HEADER_CHARS));
  }

  let body: string | undefined;
  if (input.body !== undefined) {
    if (binding.method === 'GET') return 'bad_input';
    try {
      body = JSON.stringify(input.body);
    } catch {
      return 'bad_input';
    }
    if (typeof body !== 'string' || body.length > MAX_BODY_CHARS) return 'bad_input';
    headers.set('content-type', 'application/json');
  }
  return new NextRequest(url, { method: binding.method, headers, ...(body === undefined ? {} : { body }) });
}

/** Loads the module, runs the handler in the session and audit scopes, reads the response. Never rejects. */
async function runStep(
  binding: RouteBinding,
  request: NextRequest,
  params: Record<string, string>,
  ctx: DispatchContext,
  progress: { handlerStarted: boolean },
): Promise<StepResult> {
  // An object, not a `let`: TypeScript would narrow a local in the catch block to the last assignment.
  const at: { stage: 'load' | 'session' | 'handler' | 'read' } = { stage: 'load' };
  try {
    const routeModule = await binding.load();
    const handler = routeModule?.[binding.method];
    if (typeof handler !== 'function') return { ok: false, reason: 'no_handler', ran: false };
    const call = handler as (req: NextRequest, context: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;

    at.stage = 'session';
    const audit = { ...ctx.audit, agent_tool: ctx.audit.agent_tool ?? binding.operation };
    const response = await runWithAgentAuditContext(audit, () =>
      runAsVerifiedSession(ctx.session, async () => {
        at.stage = 'handler';
        progress.handlerStarted = true;
        return call(request, { params: Promise.resolve(params) });
      }),
    );

    at.stage = 'read';
    if (!isResponseLike(response)) return { ok: false, reason: 'bad_response', ran: true };
    const text = await response.text();
    return { ok: true, raw: { status: response.status, text, retryAfter: response.headers.get('retry-after') } };
  } catch (error) {
    if (at.stage === 'load') return { ok: false, reason: 'load_failed', error, ran: false };
    if (at.stage === 'session') return { ok: false, reason: 'session_refused', error, ran: false };
    return { ok: false, reason: at.stage === 'handler' ? 'handler_threw' : 'bad_response', error, ran: true };
  }
}

/**
 * Calls the route `binding` names with `input`, as the session in `ctx`. Always resolves to an `Outcome`.
 *
 * `input` is `{ params, query, body }`: the `params` names must be exactly the `[name]` placeholders of
 * `binding.path` (use `bindingInput(binding, args)` to apply the binding's builders to a step's args).
 */
export async function invokeRoute(binding: RouteBinding, input: DispatchInput, ctx: DispatchContext): Promise<Outcome> {
  const write = binding.method !== 'GET';
  const tag = `[admin-agent] dispatch ${binding.operation}`;

  if (!isUnexpired(ctx.session.expires)) {
    return { kind: 'unauthenticated', httpStatus: 401, code: 'unauthenticated', sessionExpired: true };
  }

  const request = buildRequest(binding, input, ctx);
  if (typeof request === 'string') {
    console.error(`${tag}: ${request}`);
    return harnessError(request, { write, ran: false });
  }

  const timeoutMs = binding.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS;
  const progress = { handlerStarted: false };
  const work = runStep(binding, request, { ...(input.params ?? {}) }, ctx, progress);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  let step: StepResult | 'timeout';
  try {
    step = await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }

  if (step === 'timeout') {
    console.error(`${tag}: step timeout after ${timeoutMs} ms; the handler may still be running`);
    // `work` never rejects; report how a late handler ended, for whoever reconciles the step.
    void work.then((late) => {
      console.error(`${tag}: finished after its step timeout (${late.ok ? `status ${late.raw.status}` : late.reason})`);
    });
    // Nothing ran if the deadline hit while the module was still loading.
    return harnessError('step_timeout', { write, ran: progress.handlerStarted });
  }

  if (!step.ok) {
    console.error(`${tag}: ${step.reason}`, step.error ?? '');
    return harnessError(step.reason, { write, ran: step.ran });
  }

  const { raw } = step;
  const body = raw.text.length > MAX_RESPONSE_CHARS ? undefined : parseBody(raw.text);
  return mapRouteResponse({ status: raw.status, body, retryAfter: raw.retryAfter }, { write });
}
