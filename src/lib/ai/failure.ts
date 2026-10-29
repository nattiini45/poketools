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

const MAX_CAUSE_LENGTH = 160;

function shortCause(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_CAUSE_LENGTH ? `${flat.slice(0, MAX_CAUSE_LENGTH)}…` : flat;
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
      code: 'ai_service_unavailable',
      message: err.message,
      stored: `ai_service_unavailable: HTTP ${err.upstreamStatus ?? '?'} ${err.upstreamType ?? 'unknown'} on ${err.model}`,
    };
  }
  const status = upstreamStatus(err);
  return {
    code: fallback.code,
    message: fallback.message,
    stored: `${fallback.code}: ${status !== null ? `upstream HTTP ${status}` : shortCause(err)}`,
  };
}
