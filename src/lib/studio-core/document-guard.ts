/**
 * The cheap gate every studio route runs on a document BEFORE any object-level parse or database call.
 *
 * `documentProblem` accepts a plain JSON object within the kit's default limits (64 levels, 150,000 nodes, 262,144
 * canonical bytes) and names the first reason otherwise: arrays, `null`, scalars, strings with a NUL character, non-JSON
 * values and oversized or too deeply nested input. The walk is the iterative `inspectJson`, so a megabyte of `[[[[...`
 * finishes without a stack overflow. Each studio turns the reason into its own typed error (`assertDocument`).
 *
 * Pure: no Next, no Supabase.
 */
import { inspectJson } from './json';

export type DocumentProblem = 'not_object' | 'not_json' | 'too_deep' | 'too_many_nodes' | 'too_large';

/** Why `value` is not an acceptable document, or `null` when it is. */
export function documentProblem(value: unknown): DocumentProblem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not_object';
  const result = inspectJson(value);
  if (result.ok) return null;
  switch (result.reason) {
    case 'depth':
      return 'too_deep';
    case 'nodes':
      return 'too_many_nodes';
    case 'bytes':
      return 'too_large';
    case 'not_json':
      return 'not_json';
  }
}
