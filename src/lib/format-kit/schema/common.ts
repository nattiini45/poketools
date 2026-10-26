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
import { KEY_PATTERN, KIND_PATTERN, SLUG_PATTERN, UUID_PATTERN } from '@/lib/studio-core/keys';

export const keySchema = z.string().regex(KEY_PATTERN);
export const slugSchema = z.string().regex(SLUG_PATTERN);
export const kindSchema = z.string().regex(KIND_PATTERN);
export const uuidSchema = z.string().regex(UUID_PATTERN);

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
