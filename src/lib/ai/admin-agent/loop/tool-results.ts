/**
 * What the model reads back from a tool call: a JSON string, `{ok: true, data}` or `{ok: false, code, params?}`. A failure
 * is a catalogued code, never `err.message` (plan 3.3). The string is stored as the `content` of the `tool_result` block
 * and replayed byte for byte.
 */
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { ToolResultBlock } from './blocks';
import { isCatalogued, plainParams } from './codes';
import { stableStringify } from './harness';
import type { ToolRunResult } from './types';

/** The most one tool result may weigh in the transcript. Registry tools cap themselves well below it. */
export const MAX_TOOL_RESULT_BYTES = 96 * 1024;

export interface SerializedToolResult {
  content: string;
  isError: boolean;
  /** The code of a failure, for the stream and the UI projection. */
  code?: string;
  /** Set when the loop replaced the tool's own result (an uncatalogued code or an oversized result). */
  replaced?: 'uncatalogued_code' | 'too_large' | 'unserializable';
}

function failure(code: ApiErrorCode, params?: Readonly<Record<string, string | number>>): SerializedToolResult {
  const body = params === undefined ? { ok: false, code } : { ok: false, code, params };
  return { content: stableStringify(body), isError: true, code };
}

/** A failure the loop itself produces (a cap, a skipped call, a refused turn). */
export function failureResult(code: ApiErrorCode, params?: Readonly<Record<string, string | number>>): SerializedToolResult {
  return failure(code, plainParams(params));
}

export function serializeToolResult(result: ToolRunResult): SerializedToolResult {
  if (!result.ok) {
    if (!isCatalogued(result.code)) {
      console.error(`[admin-agent] tool answered an uncatalogued code: ${String(result.code)}`);
      return { ...failure('agent_harness_error'), replaced: 'uncatalogued_code' };
    }
    return failure(result.code, plainParams(result.params));
  }
  let content: string;
  try {
    // Through JSON first, so a Date or a toJSON() value becomes what the wire would carry.
    content = stableStringify(JSON.parse(JSON.stringify({ ok: true, data: result.data })));
  } catch (error) {
    console.error('[admin-agent] tool result could not be serialised', error);
    return { ...failure('agent_harness_error'), replaced: 'unserializable' };
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_TOOL_RESULT_BYTES) {
    console.error(`[admin-agent] tool result is ${Buffer.byteLength(content, 'utf8')} bytes, over the ${MAX_TOOL_RESULT_BYTES} cap`);
    return { ...failure('agent_harness_error'), replaced: 'too_large' };
  }
  return { content, isError: false };
}

/** The `tool_result` block of a serialised result. */
export function toolResultBlock(toolUseId: string, serialized: SerializedToolResult): ToolResultBlock {
  return serialized.isError
    ? { type: 'tool_result', tool_use_id: toolUseId, content: serialized.content, is_error: true }
    : { type: 'tool_result', tool_use_id: toolUseId, content: serialized.content };
}
