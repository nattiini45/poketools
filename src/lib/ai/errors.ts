import { UserFacingError } from '@/lib/api/user-facing-error';
// The plain EN catalog object only (no define/runtime imports), as `error-response.ts` does.
import aiMessages from '@/i18n/messages/errors/ai/en';

/**
 * Typed failures of a model call.
 *
 * They are deterministic for the request that produced them: asking again (or asking a weaker
 * model) would spend another paid call for the same outcome, so the fallback ladders rethrow
 * them instead of falling back. Each carries an `errors/ai` code, so a route that lets one
 * reach `safeErrorResponse()` answers with a specific code and a safe English message, and the
 * streamed generators read the same fields through `describeAiFailure()` (`./failure`).
 *
 * The messages are fixed catalog text: no prompt text, model output or provider message.
 */

/** The model hit its output cap (`max_tokens`) on a caller that needs a complete answer. */
export class OutputCapError extends UserFacingError<'ai_output_truncated'> {
  readonly model: string;
  readonly maxTokens: number | null;

  constructor(model: string, maxTokens: number | null) {
    super(aiMessages.ai_output_truncated, { code: 'ai_output_truncated', status: 502 });
    this.name = 'OutputCapError';
    this.model = model;
    this.maxTokens = maxTokens;
  }
}

/** The model (or a safety classifier) refused to answer. */
export class RefusalError extends UserFacingError<'ai_output_refused'> {
  readonly model: string;
  /** Classifier category (`cyber`, `bio`) when the API names one; otherwise null. */
  readonly category: string | null;

  constructor(model: string, category: string | null = null) {
    super(aiMessages.ai_output_refused, { code: 'ai_output_refused', status: 422 });
    this.name = 'RefusalError';
    this.model = model;
    this.category = category;
  }
}

/**
 * The provider rejected the request itself (a 4xx other than 408/409/429): a bad request, a
 * credential or permission problem, an unknown model id. Asking another model with the same
 * request and key does not help, so this is surfaced instead of falling back.
 */
export class ModelRejectedError extends UserFacingError<'ai_request_rejected'> {
  readonly model: string;
  readonly upstreamStatus: number | null;
  /** The provider's `error.type` (for example `invalid_request_error`), or null. */
  readonly upstreamType: string | null;

  constructor(model: string, upstreamStatus: number | null, upstreamType: string | null, cause?: unknown) {
    super(aiMessages.ai_request_rejected, { code: 'ai_request_rejected', status: 502 });
    this.name = 'ModelRejectedError';
    this.model = model;
    this.upstreamStatus = upstreamStatus;
    this.upstreamType = upstreamType;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * The call finished without any text. Unlike the typed errors above this is transient (a
 * different model may answer), so the ladders do fall back on it.
 */
export class EmptyModelResponseError extends Error {
  readonly model: string;

  constructor(model: string, detail = 'Empty response') {
    super(`${detail} from model ${model}`);
    this.name = 'EmptyModelResponseError';
    this.model = model;
  }
}

/** Errors the fallback ladders never retry: the same request would fail the same way. */
export function isDeterministicModelError(err: unknown): err is OutputCapError | RefusalError | ModelRejectedError {
  return err instanceof OutputCapError || err instanceof RefusalError || err instanceof ModelRejectedError;
}

/** Socket-level error codes that mean the connection broke, not that the request was bad. */
const NETWORK_ERROR_CODES = new Set([
  'ConnectionRefused',
  'ConnectionClosed',
  'FailedToOpenSocket',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** `fetch` (undici) failure messages that carry no code of their own. */
const NETWORK_ERROR_MESSAGES = new Set(['terminated', 'fetch failed', 'other side closed']);

/**
 * Whether an error, or anything in its `cause` chain, is a broken connection: a socket error
 * code, or the bare `TypeError('terminated')` / `TypeError('fetch failed')` that undici throws
 * when the peer drops the response body mid-stream. A plain programming `TypeError` is not.
 */
export function isNetworkFailure(err: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = err;
  while (current instanceof Error && !visited.has(current) && visited.size < 8) {
    visited.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
    if (current instanceof TypeError && NETWORK_ERROR_MESSAGES.has(current.message.toLowerCase())) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
