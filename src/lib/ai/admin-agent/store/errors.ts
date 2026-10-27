/**
 * Errors of the assistant's store.
 *
 * - `AdminAgentStoreError` is a domain refusal (busy, not found, stale, over a cap). It is a `UserFacingError` whose
 *   `code` is an `errors/admin-assistant` code and whose message is that catalog's English text, so a route passes it
 *   through `safeErrorResponse` and the loop hands the model the code only (never `err.message`). `detail` and `reason`
 *   are for logs and tests, never for a client.
 * - `AdminAgentStoreDbError` is an unexpected database failure. Its message is static (operation and SQLSTATE or
 *   signal word); the PostgREST error is kept as `cause` for the server log. It is not a `UserFacingError`, so a
 *   route answers the generic fallback and the loop reports `agent_harness_error`.
 * - `mapStoreDbError` turns the signals of the assistant's functions (P0001 words) into the first kind, and anything
 *   else into the second.
 */
import { createTranslator } from '@/i18n/core';
import type { ApiErrorParams } from '@/i18n/messages/errors';
import { errorsAdminAssistant } from '@/i18n/messages/errors/admin-assistant';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { parseDbError } from '@/lib/studio-core/db-errors';

export const ADMIN_AGENT_STORE_ERROR_STATUS = {
  agent_conversation_busy: 409,
  agent_admin_busy: 409,
  conversation_not_found: 404,
  proposal_not_found: 404,
  proposal_not_pending: 409,
  proposal_expired: 409,
  proposal_token_invalid: 409,
  proposal_conflict_executing: 409,
  plan_stale: 409,
  agent_cap_reached: 429,
  agent_budget_conversation: 429,
  agent_budget_admin_day: 429,
  agent_budget_admin_month: 429,
  agent_budget_global_day: 429,
  agent_harness_error: 500,
} as const;

export type AdminAgentStoreErrorCode = keyof typeof ADMIN_AGENT_STORE_ERROR_STATUS;

const english = createTranslator(errorsAdminAssistant, 'en');

export class AdminAgentStoreError<C extends AdminAgentStoreErrorCode = AdminAgentStoreErrorCode> extends UserFacingError<C> {
  /** Machine data for logs and tests (current status, used and cap, ...). Never sent to a client. */
  readonly detail: Readonly<Record<string, unknown>>;
  /** A finer cause under one code (`payload_forbidden`, `usage_not_found`, ...). */
  readonly reason?: string;

  constructor(code: C, params?: ApiErrorParams<C>, extra: { detail?: Readonly<Record<string, unknown>>; reason?: string } = {}) {
    super(english.dynamic(code, params as Record<string, string | number> | undefined), {
      code,
      params,
      status: ADMIN_AGENT_STORE_ERROR_STATUS[code],
    });
    this.name = 'AdminAgentStoreError';
    this.detail = extra.detail ?? {};
    this.reason = extra.reason;
  }
}

export class AdminAgentStoreDbError extends Error {
  readonly operation: string;
  /** SQLSTATE, or the signal word of a P0001 (`ADMIN_AGENT_IMMUTABLE`, ...). */
  readonly dbCode: string | undefined;

  constructor(operation: string, cause: unknown) {
    const signal = parseDbError(cause);
    const dbCode = signal?.code === 'P0001' ? signal.message : signal?.code;
    super(`admin-agent store: ${operation} failed${dbCode ? ` (${dbCode})` : ''}`, { cause });
    this.name = 'AdminAgentStoreDbError';
    this.operation = operation;
    this.dbCode = dbCode;
  }
}

/** A database error of `operation` as a typed error. A P0001 word the assistant's functions raise maps to a domain error. */
export function mapStoreDbError(operation: string, error: unknown): AdminAgentStoreError | AdminAgentStoreDbError {
  const signal = parseDbError(error);
  if (signal?.code === 'P0001' && signal.message === 'ADMIN_AGENT_CONVERSATION_NOT_FOUND') {
    return new AdminAgentStoreError('conversation_not_found');
  }
  return new AdminAgentStoreDbError(operation, error);
}

/** Whether a PostgREST error is a unique violation (23505), optionally of the constraint or index `name`. */
export function isUniqueViolation(error: unknown, name?: string): boolean {
  const signal = parseDbError(error);
  if (signal?.code !== '23505') return false;
  return name === undefined || signal.constraint === name || (signal.message?.includes(name) ?? false);
}

/** The result of a PostgREST call: throws the mapped error, else the data. */
export function unwrap<T>(operation: string, result: { data: T; error: unknown }): T {
  if (result.error) throw mapStoreDbError(operation, result.error);
  return result.data;
}

/** Like `unwrap` for `.single()` / `.insert().select().single()`: the row, which exists when the call did not fail. */
export function unwrapRow<T>(operation: string, result: { data: T; error: unknown }): NonNullable<T> {
  const row = unwrap(operation, result);
  if (row === null || row === undefined) throw new AdminAgentStoreDbError(operation, new Error('the statement returned no row'));
  return row;
}
