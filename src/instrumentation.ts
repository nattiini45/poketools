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
