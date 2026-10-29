import { ERROR_CATALOGS, type ApiErrorCode } from '@/i18n/messages/errors';
import { isSupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { ToolError } from './types';

/**
 * Tool failures reach the model as a catalogued code plus params, never `err.message` (plan 3.3; contrast the player
 * agent, which hands the model raw error text). The code is a key of an error catalog (`src/i18n/messages/errors/**`),
 * so the same code renders in the admin's language on the page and is checked by the catalog tests.
 */

let known: ReadonlySet<string> | null = null;

/** Whether `code` is a key of some error catalog. */
export function isCataloguedCode(code: unknown): code is ApiErrorCode {
  if (typeof code !== 'string') return false;
  if (known === null) {
    const all = new Set<string>();
    for (const catalog of Object.values(ERROR_CATALOGS)) for (const key of Object.keys(catalog.en)) all.add(key);
    known = all;
  }
  return known.has(code);
}

export function toolError(code: ApiErrorCode, params?: Readonly<Record<string, string | number>>): ToolError {
  return params === undefined ? { ok: false, code } : { ok: false, code, params };
}

/** Keeps only string and number params, short: they come from route errors and must stay small and plain. */
function safeParams(params: unknown): Readonly<Record<string, string | number>> | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Duck type of `AuthError` (a numeric `statusCode` and a `code`), as `safeErrorResponse` does, without importing next-auth. */
function authCode(err: unknown): ApiErrorCode | undefined {
  if (!(err instanceof Error) || !('statusCode' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return isCataloguedCode(code) ? code : undefined;
}

/**
 * Maps whatever a guard, a query or a library function threw to a catalogued code:
 *  - `UserFacingError` (and its subclasses: `RulesetStudioError`, `FormatStudioError`, ...): its own code and params;
 *  - `AuthError`: its code (`unauthenticated`, `forbidden`, `account_banned`, `account_suspended`);
 *  - a Supabase request deadline: `upstream_timeout`;
 *  - anything else: `agent_harness_error`, with the original error logged under `[admin-agent]` (server only).
 * A code that is not in a catalog is never forwarded: it becomes `agent_harness_error` too.
 */
export function toolErrorFromThrown(err: unknown, where: string): ToolError {
  if (err instanceof UserFacingError) {
    if (isCataloguedCode(err.code)) return toolError(err.code, safeParams(err.params));
    console.error(`[admin-agent] ${where}: uncatalogued domain error`, err);
    return toolError('agent_harness_error');
  }
  if (isSupabaseTimeoutError(err)) {
    console.error(`[admin-agent] ${where}: Supabase request deadline`, err);
    return toolError('upstream_timeout');
  }
  const code = authCode(err);
  if (code !== undefined) return toolError(code);
  console.error(`[admin-agent] ${where}:`, err);
  return toolError('agent_harness_error');
}
