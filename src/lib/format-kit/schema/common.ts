/**
 * Shared zod building blocks of the format definition schema. SERVER ONLY (zod); the browser
 * validates the same shapes with the Spec interpreter in `registry/validate-spec.ts`, and a fuzz
 * parity test keeps the two identical.
 *
 * Rules for this folder: `z.strictObject` everywhere, no record type (collections are arrays with
 * key fields), no `any`, no transform that changes the input, defaults through `.default(() => ...)`
 * so every parse gets a fresh object.
 */
import { z } from 'zod';
import { KEY_PATTERN, KIND_PATTERN, SLUG_PATTERN, UUID_PATTERN } from '../keys';
import { LTEXT_MAX_CHARS } from '../limits';
import { TEXT_PATTERN } from '../registry/spec';

export const keySchema = z.string().regex(KEY_PATTERN);
export const slugSchema = z.string().regex(SLUG_PATTERN);
export const kindSchema = z.string().regex(KIND_PATTERN);
export const uuidSchema = z.string().regex(UUID_PATTERN);

/**
 * A string of `min..max` characters. The length check is a custom issue (`params.code = 'length'`)
 * that only runs on strings: zod's own length checks also run on any value that has a `length`
 * (an array, an object with a `length` key) and would report a second issue next to the type one.
 */
export function boundedString(min: number, max: number) {
  return z.string().refine((value) => value.length >= min && value.length <= max, {
    params: { code: 'length' },
    when: (payload) => typeof payload.value === 'string',
  });
}

/** A string without NUL, `min..max` characters. */
export function textString(min: number, max: number) {
  return boundedString(min, max).regex(TEXT_PATTERN);
}

/** An integer `min..max`. A non-integer is a `type` issue; the range checks are skipped then. */
export function intRange(min: number, max: number) {
  return z.number().int().min(min).max(max);
}

/** A finite number `-abs..abs`. */
export function numberAbs(abs: number) {
  return z.number().min(-abs).max(abs);
}

/**
 * An array with `min..max` items. The length check is a custom issue (`params.code = 'length'`)
 * that runs after the elements even when one of them failed: zod's own array size checks would
 * stop at an oversized array and skip the elements.
 */
export function boundedArray<T extends z.ZodType>(item: T, min: number, max: number) {
  return z.array(item).refine((items) => items.length >= min && items.length <= max, {
    params: { code: 'length' },
    when: (payload) => Array.isArray(payload.value),
  });
}

const ltextValueSchema = z.strictObject({
  v: textString(1, LTEXT_MAX_CHARS),
  s: z.enum(['human', 'machine', 'reviewed']),
});

/**
 * `{ en?, de?, base }`: each present language is `{ v, s }`, and the `base` language must be
 * present (a `refine` issue with rule `ltext_base_present`). The refine does not run when a
 * field already failed with a type, required or enum issue.
 */
export const ltextSchema = z
  .strictObject({
    en: ltextValueSchema.optional(),
    de: ltextValueSchema.optional(),
    base: z.enum(['en', 'de']),
  })
  .refine((text) => text[text.base] !== undefined, { params: { code: 'refine', rule: 'ltext_base_present' } });
