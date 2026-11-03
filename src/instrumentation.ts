/**
 * Next.js instrumentation hook: `register()` runs once when a server instance
 * boots, before it serves a request, and an error it throws stops the boot.
 *
 * Fail fast on a misconfigured environment (lead ruling round 5): an invalid
 * optional setting such as `RATE_LIMIT_STORE=redis` fails the server start
 * through the central env schema (`assertBootEnv`, `src/lib/env.ts`) instead
 * of answering every rate-limited route with a 500. Only the Node.js runtime
 * validates: the edge runtime runs no route that reads these variables.
 *
 * The Admin Assistant's `ADMIN_AGENT_*` settings are checked beside it
 * (`assertAdminAgentBootEnv`): they stop the boot only when the assistant is
 * switched on and a value is invalid, so a deployment without it never fails here.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertBootEnv } = await import('@/lib/env');
  assertBootEnv();
  const { assertAdminAgentBootEnv } = await import('@/lib/ai/admin-agent/env');
  assertAdminAgentBootEnv();
}

type RequestErrorHeaders = NodeJS.Dict<string | string[]>;

/** Only a plain token is logged as the request id: the header is client-controlled. */
function incomingRequestId(headers: RequestErrorHeaders): string | undefined {
  const raw = headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && /^[A-Za-z0-9._-]{8,128}$/.test(value) ? value : undefined;
}

/**
 * Next.js calls this for every error that escapes a server render, route
 * handler, server action or proxy, including the ones a route's own try/catch
 * never sees. It writes one structured line (`docs/operations-logging.md`):
 * the digest that the error page shows the visitor, the request path without
 * its query string, the method, the route that matched and the serialised
 * error. Cookies, the Authorization header and the body never reach the line:
 * only `x-request-id` is read from the headers. A failure of the log call is
 * swallowed so that reporting an error cannot raise another one.
 */
export async function onRequestError(
  err: unknown,
  request: Readonly<{ path: string; method: string; headers: RequestErrorHeaders }>,
  context: Readonly<{ routerKind: string; routePath: string; routeType: string }>
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { logger } = await import('@/lib/logger');
    const digest = (err as { digest?: unknown } | null)?.digest;
    logger.error('request', 'Unhandled server error', {
      digest: typeof digest === 'string' ? digest : undefined,
      requestId: incomingRequestId(request.headers),
      path: request.path.split(/[?#]/)[0],
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      error: err,
    });
  } catch {
    // Reporting must never throw.
  }
}
