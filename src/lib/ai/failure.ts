import type { ApiErrorCode } from '@/i18n/messages/errors';
import { ModelRejectedError, OutputCapError, RefusalError } from './errors';

/**
 * How a failed generation is reported by the streamed generators (`api/ai/**`):
 *
 * - `code` and `message` go into the SSE `failed` frame (English `message`, client translates by
 *   `code`),
 * - `stored` goes into the row's `error` column: a stable code, then a short cause. It holds no
 *   prompt text and no provider message, only fields this app or the SDK exposes as data
 *   (status, error type, model id, token cap).
 */
export interface AiFailureDescription {
  code: ApiErrorCode;
  message: string;
  stored: string;
}

/** What a route reports when the cause is not one of the typed model failures. */
export interface AiFailureFallback {
  code: ApiErrorCode;
  message: string;
}

/**
 * The error's class name only. Messages are never stored: a JSON parse error quotes the model's
 * output and provider errors quote the provider; both stay in the caller's console line.
 */
function shortCause(err: unknown): string {
  return err instanceof Error ? err.name.slice(0, 60) : typeof err;
}

/** The upstream status of an SDK or AI SDK error, or null. */
function upstreamStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const record = err as { status?: unknown; statusCode?: unknown };
  const status = typeof record.status === 'number' ? record.status : record.statusCode;
  return typeof status === 'number' ? status : null;
}

export function describeAiFailure(err: unknown, fallback: AiFailureFallback): AiFailureDescription {
  if (err instanceof OutputCapError) {
    return {
      code: 'ai_output_truncated',
      message: err.message,
      stored: `ai_output_truncated: max_tokens ${err.maxTokens ?? 'unknown'} on ${err.model}`,
    };
  }
  if (err instanceof RefusalError) {
    return {
      code: 'ai_output_refused',
      message: err.message,
      stored: `ai_output_refused: ${err.category ?? 'refusal'} on ${err.model}`,
    };
  }
  if (err instanceof ModelRejectedError) {
    return {
      code: 'ai_request_rejected',
      message: err.message,
      stored: `ai_request_rejected: HTTP ${err.upstreamStatus ?? '?'} ${err.upstreamType ?? 'unknown'} on ${err.model}`,
    };
  }
  const status = upstreamStatus(err);
  return {
    code: fallback.code,
    message: fallback.message,
    stored: `${fallback.code}: ${status !== null ? `upstream HTTP ${status}` : shortCause(err)}`,
  };
}
