/**
 * Request checks shared by the assistant's state-changing routes: the browser-only origin rule, the JSON content type,
 * the bounded body and a zod parse. Everything here runs before any work (spec §5: "a non-JSON body, an oversized body
 * or a malformed path id is refused before any work").
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createBodyReaders } from '@/lib/studio-core/api-body';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { agentError } from './errors';

/**
 * The assistant is a browser feature. A POST must carry an `Origin` equal to this site's and `Sec-Fetch-Site:
 * same-origin`; a missing, `null` or cross-site origin is refused (the general helpers accept a missing one). The live
 * cookie session of the same admin stays the authority; this only closes the cross-site request path.
 */
export function assertSameOriginRequest(request: Request & { nextUrl: { origin: string } }): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin === null || origin === 'null' || origin !== request.nextUrl.origin || fetchSite !== 'same-origin') {
    console.error('[admin-agent] cross-site or origin-less request refused', { origin, fetchSite });
    throw new UserFacingError('You do not have permission to do this.', { code: 'forbidden', status: 403 });
  }
}

const readers = createBodyReaders({
  tooLarge: () => agentError('agent_body_too_large', 413),
  assertDocument: () => {},
});

/** A JSON body of at most `maxBytes`, parsed with `schema`. An unparsable body is 400 `invalid_json`; an invalid one 400 `validation_failed`. */
export async function readAgentJson<S extends z.ZodType>(request: Request, schema: S, maxBytes: number): Promise<z.output<S>> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) throw new UserFacingError('Invalid JSON body', { code: 'invalid_json', status: 415 });
  const raw = await readers.readBoundedJson(request, maxBytes);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationFailed(parsed.error);
  return parsed.data;
}

/** `validation_failed` with the issue paths only: never a value, never a zod message. */
export function validationFailed(error: z.ZodError): UserFacingError {
  const issues = error.issues
    .slice(0, 5)
    .map((issue) => (issue.path.length > 0 ? issue.path.join('.') : 'body'))
    .join(', ');
  return agentError('validation_failed', 400, { issues });
}

/** The standard 429 of the assistant's own limiter: `agent_rate_limited` with the seconds to wait and `Retry-After`. */
export function agentRateLimited(retryAfterSeconds: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const error = agentError('agent_rate_limited', 429, { seconds });
  return NextResponse.json(
    { success: false, error: error.message, code: error.code, params: { seconds } },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  );
}
