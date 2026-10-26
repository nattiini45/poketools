/**
 * The cheap gate every route runs on a format document BEFORE any object-level parse or database call.
 *
 * `assertDocument` accepts a plain JSON object within the kit's default limits (64 levels, 150,000 nodes, 262,144
 * canonical bytes) and nothing else: arrays, `null`, scalars, strings with a NUL character, non-JSON values and
 * oversized or too deeply nested input are refused with a typed `FormatStudioError`. The walk is the kit's
 * iterative `inspectJson`, so a megabyte of `[[[[...` finishes without a stack overflow.
 *
 * Pure: no Next, no Supabase.
 */
import { inspectJson } from '@/lib/format-kit/json';
import { FormatStudioError } from './errors';

export function assertDocument(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FormatStudioError('format_document_not_object');
  }
  const result = inspectJson(value);
  if (result.ok) return;
  switch (result.reason) {
    case 'depth':
      throw new FormatStudioError('format_document_too_deep');
    case 'nodes':
      throw new FormatStudioError('format_document_too_many_nodes');
    case 'bytes':
      throw new FormatStudioError('format_document_too_large');
    case 'not_json':
      throw new FormatStudioError('format_document_not_json');
  }
}
