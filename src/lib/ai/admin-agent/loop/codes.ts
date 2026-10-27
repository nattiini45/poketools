/**
 * Error codes of the loop (plan 3.3, 5.7): every failure that reaches the model, the stream or the route is a code of an
 * error catalog (`src/i18n/messages/errors/**`), never `err.message`.
 *
 * Some causes the loop must tell apart (a refusal is not a truncated answer is not an unavailable model) have no catalog
 * entry yet. `loopCode` returns the preferred code once the catalog has it and the fallback until then, so the stream
 * never carries a code a client cannot render; the finer cause stays in the log line and in the `reason` of the
 * `done` event. `CODES_PENDING_IN_CATALOG` lists what the catalog owner still has to add.
 */
import { createTranslator } from '@/i18n/core';
import { ERROR_CATALOGS, errorsAdminAssistant, errorsCommon, type ApiErrorCode } from '@/i18n/messages/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

let known: ReadonlySet<string> | null = null;

/** Whether `code` is a key of some error catalog. */
export function isCatalogued(code: unknown): code is ApiErrorCode {
  if (typeof code !== 'string') return false;
  if (known === null) {
    const all = new Set<string>();
    for (const catalog of Object.values(ERROR_CATALOGS)) for (const key of Object.keys(catalog.en)) all.add(key);
    known = all;
  }
  return known.has(code);
}

/** The causes the loop distinguishes, each with the code it wants and the catalogued one it falls back to. */
export const LOOP_CODES = {
  /** The model refused (`stop_reason: refusal`). */
  refused: { preferred: 'agent_model_refused', fallback: 'agent_harness_error' },
  /** The answer hit `max_tokens`. */
  truncated: { preferred: 'agent_output_truncated', fallback: 'agent_harness_error' },
  /** The provider was unavailable, overloaded, rate limited or timed out. */
  unavailable: { preferred: 'agent_model_unavailable', fallback: 'agent_harness_error' },
  /** The conversation's prompt or tool set is not the current one, or it is archived: start a new one. */
  outdated: { preferred: 'agent_conversation_outdated', fallback: 'agent_context_full' },
  /** `continue` without an unconsumed harness event. */
  nothingToContinue: { preferred: 'agent_nothing_to_continue', fallback: 'agent_harness_error' },
} as const satisfies Record<string, { preferred: string; fallback: ApiErrorCode }>;

export type LoopCause = keyof typeof LOOP_CODES;

/** The code to send for `cause`: the preferred one when the catalog has it, else the fallback. */
export function loopCode(cause: LoopCause): ApiErrorCode {
  const { preferred, fallback } = LOOP_CODES[cause];
  return isCatalogued(preferred) ? preferred : fallback;
}

/** Preferred codes the catalog does not have yet (EN and DE text still to be written by the catalog owner). */
export function codesPendingInCatalog(): string[] {
  return Object.values(LOOP_CODES)
    .map((entry) => entry.preferred as string)
    .filter((code) => !isCatalogued(code));
}

const english = createTranslator(errorsAdminAssistant, 'en');
const englishCommon = createTranslator(errorsCommon, 'en');

/** The English server message of `code` (the assistant's catalog first, then the shared one). */
function englishText(code: ApiErrorCode, params?: Readonly<Record<string, string | number>>): string {
  const translator = Object.prototype.hasOwnProperty.call(errorsAdminAssistant.en, code) ? english : englishCommon;
  return translator.dynamic(code, params as Record<string, string | number> | undefined, 'The assistant could not do this.');
}

const STATUS: Partial<Record<string, number>> = {
  agent_disabled: 404,
  agent_context_full: 409,
  agent_text_too_long: 413,
  text_not_allowed: 400,
  validation_failed: 400,
  tool_not_available: 403,
  conversation_not_found: 404,
};

/**
 * A refusal to start or continue a turn (the stream has not started, so the route can answer with a status). The
 * code is a catalog code; `reason` is for logs and tests. Store refusals (`agent_conversation_busy`, `conversation_not_found`,
 * budgets) stay `AdminAgentStoreError`s.
 */
export class AdminAgentLoopError extends UserFacingError {
  readonly reason: string;

  constructor(code: ApiErrorCode, reason: string, params?: Readonly<Record<string, string | number>>) {
    super(englishText(code, params), {
      code,
      params: params as never,
      status: STATUS[code] ?? 409,
    });
    this.name = 'AdminAgentLoopError';
    this.reason = reason;
  }
}

/** Keeps only plain string and number params, short: model-facing and stream-facing params stay small. */
export function plainParams(params: unknown): Readonly<Record<string, string | number>> | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
