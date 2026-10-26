/**
 * Schema issues: the one result shape of both document validators (zod on the server, the Spec
 * interpreter in the browser). Zod-free: `mapZodIssues` takes a structural issue type, so this file
 * is safe in client bundles.
 *
 * An issue is a code plus a JSON pointer plus small primitive params, never English text; the UI
 * renders it after the read (cache-boundary rule). Both validators run the same `finalizeIssues`
 * (sort, de-duplicate, cap), which is what makes their output comparable.
 *
 * Mapping from zod issue codes (`mapZodIssues`):
 *
 * | zod issue                                        | SchemaIssue                               |
 * | ------------------------------------------------ | ----------------------------------------- |
 * | any issue whose input is `undefined`             | `required`                                |
 * | invalid_type                                     | `type` { expected }                       |
 * | too_small / too_big on a number                  | `range`                                   |
 * | too_small / too_big on a string                  | `length`                                  |
 * | invalid_value                                    | `enum`                                    |
 * | invalid_format                                   | `pattern`                                 |
 * | unrecognized_keys                                | one `unknown_key` per key (first 100)     |
 * | invalid_union with a discriminator               | `required` (tag absent) or `enum`         |
 * | invalid_union without a discriminator            | `type` { expected: 'union' }              |
 * | custom                                           | `params.code` passthrough, other params kept |
 *
 * Array length limits are `custom` issues with `params.code = 'length'` (the schema builds them so
 * the check also runs when an element is invalid, like the browser interpreter).
 */
import { escapePointerSegment } from './patch';
import type { FormatDefinition } from './types';

export type SchemaIssueCode =
  | 'required'
  | 'type'
  | 'enum'
  | 'range'
  | 'length'
  | 'pattern'
  | 'unknown_key'
  | 'not_available_yet'
  | 'limit'
  | 'refine';

export const SCHEMA_ISSUE_CODES: readonly SchemaIssueCode[] = [
  'required',
  'type',
  'enum',
  'range',
  'length',
  'pattern',
  'unknown_key',
  'not_available_yet',
  'limit',
  'refine',
];

export type IssueParams = Readonly<Record<string, string | number | boolean>>;

export interface SchemaIssue {
  code: SchemaIssueCode;
  /** RFC 6901 pointer into the validated input; '' is the document root. */
  pointer: string;
  params: IssueParams;
}

/** Not an error: the document is valid but something was adjusted. */
export interface SchemaNote {
  code: 'unknown_primitive';
  pointer: string;
  params: { kind: string };
}

export type ValidationResult =
  | { ok: true; value: FormatDefinition; notes: SchemaNote[] }
  | { ok: false; issues: SchemaIssue[] };

/** At most this many issues are returned (after sorting); at most this many unknown keys per object. */
export const MAX_ISSUES = 100;

const EMPTY_PARAMS: IssueParams = Object.freeze({});

/** The shared empty params object (frozen). */
export function noParams(): IssueParams {
  return EMPTY_PARAMS;
}

/** RFC 6901 pointer of a path; symbols are stringified. */
export function toPointer(path: readonly (string | number | symbol)[]): string {
  let out = '';
  for (const segment of path) {
    out += '/' + (typeof segment === 'number' ? String(segment) : escapePointerSegment(String(segment)));
  }
  return out;
}

function paramsKey(params: IssueParams): string {
  const keys = Object.keys(params).sort();
  let out = '';
  for (const key of keys) out += `${key}=${String(params[key])};`;
  return out;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic order: pointer, then code, then params. Returns a new array; exact duplicates are dropped. */
export function sortIssues(issues: readonly SchemaIssue[]): SchemaIssue[] {
  const sorted = [...issues].sort(
    (a, b) =>
      compareStrings(a.pointer, b.pointer) ||
      compareStrings(a.code, b.code) ||
      compareStrings(paramsKey(a.params), paramsKey(b.params)),
  );
  const out: SchemaIssue[] = [];
  for (const issue of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.pointer === issue.pointer &&
      last.code === issue.code &&
      paramsKey(last.params) === paramsKey(issue.params)
    ) {
      continue;
    }
    out.push(issue);
  }
  return out;
}

/** `sortIssues` then the `MAX_ISSUES` cap: the result both validators return. */
export function finalizeIssues(issues: readonly SchemaIssue[]): SchemaIssue[] {
  return sortIssues(issues).slice(0, MAX_ISSUES);
}

/** Notes in pointer order. */
export function sortNotes(notes: readonly SchemaNote[]): SchemaNote[] {
  return [...notes].sort((a, b) => compareStrings(a.pointer, b.pointer) || compareStrings(a.params.kind, b.params.kind));
}

/** The part of a zod issue the mapper reads; structural so this file needs no zod import. */
export interface ZodIssueLike {
  readonly code: string;
  readonly path: readonly (string | number | symbol)[];
  /** Present when the parse ran with `reportInput: true`. */
  readonly input?: unknown;
  readonly expected?: string;
  readonly origin?: string;
  readonly keys?: readonly string[];
  readonly discriminator?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

const SCHEMA_CODE_SET: ReadonlySet<string> = new Set(SCHEMA_ISSUE_CODES);

function primitiveParams(source: Readonly<Record<string, unknown>> | undefined, skip: string): IssueParams {
  if (!source) return EMPTY_PARAMS;
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(source)) {
    if (key === skip) continue;
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function typeName(expected: string | undefined): string {
  if (expected === 'int') return 'integer';
  return expected ?? 'unknown';
}

/**
 * Maps zod issues to schema issues (unsorted). Run the parse with `reportInput: true`, otherwise
 * an absent value cannot be told from a wrong one.
 */
export function mapZodIssues(zodIssues: readonly ZodIssueLike[]): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  for (const issue of zodIssues) {
    const pointer = toPointer(issue.path);
    if (issue.code === 'unrecognized_keys') {
      for (const key of (issue.keys ?? []).slice(0, MAX_ISSUES)) {
        out.push({ code: 'unknown_key', pointer: toPointer([...issue.path, key]), params: EMPTY_PARAMS });
      }
      continue;
    }
    if (issue.code === 'custom') {
      const wanted = issue.params?.code;
      if (typeof wanted === 'string' && SCHEMA_CODE_SET.has(wanted)) {
        out.push({ code: wanted as SchemaIssueCode, pointer, params: primitiveParams(issue.params, 'code') });
      } else {
        out.push({ code: 'refine', pointer, params: { rule: 'custom' } });
      }
      continue;
    }
    if (issue.code === 'invalid_union' && issue.discriminator !== undefined) {
      const input = issue.input;
      const tagAbsent =
        typeof input === 'object' && input !== null && !Object.prototype.hasOwnProperty.call(input, issue.discriminator);
      out.push({ code: tagAbsent ? 'required' : 'enum', pointer, params: EMPTY_PARAMS });
      continue;
    }
    if (issue.input === undefined && 'input' in issue) {
      out.push({ code: 'required', pointer, params: EMPTY_PARAMS });
      continue;
    }
    switch (issue.code) {
      case 'invalid_type':
        out.push({ code: 'type', pointer, params: { expected: typeName(issue.expected) } });
        break;
      case 'too_small':
      case 'too_big':
        out.push({
          code: issue.origin === 'string' || issue.origin === 'array' ? 'length' : 'range',
          pointer,
          params: EMPTY_PARAMS,
        });
        break;
      case 'invalid_value':
        out.push({ code: 'enum', pointer, params: EMPTY_PARAMS });
        break;
      case 'invalid_format':
        out.push({ code: 'pattern', pointer, params: EMPTY_PARAMS });
        break;
      case 'invalid_union':
        out.push({ code: 'type', pointer, params: { expected: 'union' } });
        break;
      default:
        out.push({ code: 'refine', pointer, params: { rule: issue.code } });
    }
  }
  return out;
}
